/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Asymmetric bounded unidirectional integer-bundle queues.
 *
 * All data that can be communicated through shared memory can be
 * marshaled as integer data, so these queues are general building
 * blocks for inter-thread data communication through shared memory.
 *
 * There are two data structures:
 *
 * MasterProducerIntQueue sends int32 bundles from the master to the
 * workers.
 *
 * WorkerProducerIntQueue sends int32 bundles from an worker producers
 * to the master.
 *
 * There are different implementations and APIs for the two directions
 * of the queue because the master is single-threaded and can't block,
 * while there can be concurrent blocking workers.  (The two data
 * types could be merged but there doesn't seem to be any point.)
 *
 *
 * Data is communicated as bundles of int32 values, such a bundle is
 * called an "item" below.  At the producer API an item is something
 * that has a length property and responds to indexed read operations
 * - Arrays, TypedArrays, or something application-specific.  At the
 * consumer API, an item comes out as an Array.
 *
 *
 * MasterProducerIntQueue producer API:
 *
 *  q.putOrFail(item) => true if the item was inserted, false if not
 *  q.callWhenCanPut(itemSize, callback) => true if callback was invoked directly, otherwise false
 *
 * MasterProducerIntQueue consumer API (worker side):
 *
 *  q.canTake() => true if an item is available
 *  q.takeOrFail() => item or null
 *  q.take() => item, blocks until available
 *
 *
 * WorkerProducerIntQueue producer API:
 *
 *  q.putOrFail(item) => true if the item was inserted, false if not
 *  q.put(item) => undefined, blocks until space is vailable
 *
 * WorkerProducerIntQueue consumer API (master side):
 *
 *  q.canTake() => true if an item is available
 *  q.takeOrFail() => item or null
 *  q.callWhenCanTake(callback) => true if callbck was invoked directly, otherwise false
 */

/* IMPORTANT USAGE NOTE:
 *
 * Clients of this library must ensure that
 * AsymmetricSynchronic.filterEvent is invoked on Message events
 * received in the master.  See AsymmetricSynchronic for more
 * information.
 *
 * (Yes, this is noncomposable in an interesting way.  It's possible
 * for each library to install a handler, and it'll work, but not
 * great.)
 */

/* Implementation.
 *
 * Both queues have the same structure.
 *
 * I is the insertion pointer: the circular buffer index of the first
 * available slot past the last item.  Updated atomically by the master.
 *
 * R is the removal pointer: the circular buffer index of the first
 * element of the oldest item still in the buffer.  Updated atomically
 * by the workers (see below).
 *
 *   The buffer size bufsize is the number of data slots available.
 *
 *   Both I and R increase modulo bufsize.
 *
 *   The free capacity of a queue is R-I if I < R and bufsize-(I-R)
 *   otherwise.
 *
 * POP is a synchronic that is used for signaling insertions and
 * removals, it has the count of integer values (not items) in the
 * queue.  The producer adds to POP when an item has been inserted;
 * the consumer subtracts from POP when an item has been removed.
 * Consumers that find the queue empty and producers that find the
 * queue at capacity can wait for updates to POP.
 *
 * The queue is empty if free==bufsize.
 *
 * LATCH is a synchronic that's used as a latch to create a critical
 * section in the workers: in the MasterProducerIntQueue, R is only
 * updated with the latch held, allowing for concurrent consumers; in
 * the WorkerProducerIntQueue, I is only updated with the latch held,
 * allowing for concurrent producers.
 *
 * Memory layout:
 *                      I                                   R
 * +------+-----------------------------------------------------------+
 * |(meta)|ddddHdddddddd   --->                             HddddddHdd|
 * +------------------------------------------------------------------+
 *
 * where meta contains I, R, POP, and LATCH.
 */

"use strict";

function align(n, v) {
    return (n + (v-1)) & ~(v-1);
}

// Byte offsets
const _IQ_I      = 0;
const _IQ_R      = _IQ_I + 4;
const _IQ_POP    = align(_IQ_R + 4, AsymmetricSynchronic.BYTE_ALIGN);
const _IQ_LATCH  = align(_IQ_POP + AsymmetricSynchronic.BYTE_SIZE, AsymmetricSynchronic.BYTE_ALIGN);
const _IQ_BUF    = align(_IQ_LATCH + AsymmetricSynchronic.BYTE_SIZE, 4);
const _IQ_START  = _IQ_BUF;

// Int32 offsets
const _IQ_INSERT = _IQ_I >> 2;
const _IQ_REMOVE = _IQ_R >> 2;
const _IQ_BASE   = _IQ_START >> 2;

///////////////////////////////////////////////////////////////////////////
//
// MasterProducerIntQueue.

/**
 * "sab" is a SharedByteArray.
 * "offset" is an aligned offset within "sab"
 * "numBytes" is the size of the reserved area in "sab".
 * "isMaster" is true if this is being constructed on the master thread.
 */
function MasterProducerIntQueue(sab, offset, numBytes, isMaster) {
    this._size = (numBytes - MasterProducerIntQueue.BYTE_SIZE) >> 2;
    if (this._size <= 0)
	throw new Error("Buffer too small: " + numBytes);
    this._ia = new Int32Array(sab, offset, numBytes >> 2);
    this._pop = new AsymmetricSynchronic(sab, offset + _IQ_POP, isMaster, 0);
    this._latch = new AsymmetricSynchronic(sab, offset + _IQ_LATCH, isMaster, 0);
    if (isMaster) {
	Atomics.store(this._ia, _IQ_INSERT, 0);
	Atomics.store(this._ia, _IQ_REMOVE, 0);
    }
}

/**
 * The amount of space needed for the MasterProducerQueue for its
 * internal data structures.  Any additional space should be divisible
 * by 4 (for integer data) and will be used for the buffer.
 */
MasterProducerIntQueue.BYTE_SIZE = _IQ_START;

/**
 * The required byte alignment, divisible by 4, no larger than 16.
 */
MasterProducerIntQueue.BYTE_ALIGN = AsymmetricSynchronic.BYTE_ALIGN;

// The implementation uses this equivalence.

MasterProducerIntQueue.IMMEDIATE = AsymmetricSynchronic.IMMEDIATE;
MasterProducerIntQueue.DELAYED = AsymmetricSynchronic.DELAYED;

/**
 * Insert the item if possible, and return true if so.  Otherwise
 * return false.
 */
MasterProducerIntQueue.prototype.putOrFail = function (item) {
    this._checkAPI("putOrFail", true);
    let ia = this._ia;
    let size = this._size;
    let insert = Atomics.load(ia, _IQ_INSERT);
    let remove = Atomics.load(ia, _IQ_REMOVE);
    let avail = insert < remove ? remove-insert : size-(insert-remove);

    if (avail < item.length + 1)
	return false;

    ia[_IQ_BASE + insert] = item.length;
    insert = (insert + 1) % size;
    for ( let i=0 ; i < item.length ; i++ ) {
	ia[_IQ_BASE + insert] = item[i];
	insert = (insert + 1) % size;
    }

    Atomics.store(ia, _IQ_INSERT, insert);
    this._pop.add(item.length + 1);

    return true;
}

/**
 * Invoke callback when there's space available in the queue for an
 * item of length itemSize.  The callback is invoked with a value
 * indicating when it was called: MasterProducerIntQueue.IMMEDIATE if
 * it was invoked immediately, MasterProducerIntQueue.DELAYED if it
 * was invoked later.
 *
 * Returns true if the callback was invoked immediately, otherwise
 * false.
 *
 * Typical usage here would be to call callWhenCanPut with a thunk
 * that calls putOrFail on the same item (and asserts if the latter
 * call fails).
 */
MasterProducerIntQueue.prototype.callWhenCanPut = function (itemSize, callback) {
    this._checkAPI("callWhenCanPut", true);
    let ia = this._ia;
    let size = this._size;
    let pop = this._pop;
    let check = (when) => {
	let oldpop = pop.load();
	let insert = Atomics.load(ia, _IQ_INSERT);
	let remove = Atomics.load(ia, _IQ_REMOVE);
	let avail = insert < remove ? remove-insert : size-(insert-remove);
	if (avail < itemSize + 1)
	    return pop.callWhenNotEquals(oldpop, check);
	callback(when);
	return when == MasterProducerIntQueue.IMMEDIATE;
    }
    return check(MasterProducerIntQueue.IMMEDIATE);
}

MasterProducerIntQueue.prototype.canTake = function () {
    this._checkAPI("canTake", false);
    return this._pop.load() > 0;
}

MasterProducerIntQueue.prototype.takeOrFail = function () {
    this._checkAPI("takeOrFail", false);
    let ia = this._ia;
    let latch = this._latch;
    let size = this._size;
    while (latch.compareExchange(0,1) == 1)
	latch.waitUntilEquals(0);
    let insert = Atomics.load(ia, _IQ_INSERT);
    let remove = Atomics.load(ia, _IQ_REMOVE);
    if (insert == remove) {
	latch.store(0);
	return false;
    }
    let n = ia[_IQ_BASE + remove];
    remove = (remove + 1) % size;
    let item = [];
    for ( ; n > 0 ; n-- ) {
	item.push(ia[_IQ_BASE + remove]);
	remove = (remove + 1) % size;
    }
    Atomics.store(ia, _IQ_REMOVE, remove);
    this._pop.sub(item.length + 1);
    latch.store(0);
    return item;
}

MasterProducerIntQueue.prototype.take = function () {
    this._checkAPI("take", false);
    for (;;) {
	let item = this.takeOrFail();
	if (item)
	    return item;
	this._pop.waitUntilNotEquals(0);
    }
}

MasterProducerIntQueue.prototype._checkAPI = function(m, masterAPI) {
    if (masterAPI == this._isMaster)
	throw new Error("MasterProducerIntQueue API abuse: method '" + m + "' not available in " + (this._isMaster ? "master" : "worker"));
}


///////////////////////////////////////////////////////////////////////////
//
// WorkerProducerIntQueue.

function WorkerProducerIntQueue(sab, offset, numBytes, isMaster) {
    this._size = (numBytes - WorkerProducerIntQueue.BYTE_SIZE) >> 2;
    if (this._size <= 0)
	throw new Error("Buffer too small: " + numBytes);
    this._ia = new Int32Array(sab, offset, numBytes >> 2);
    this._pop = new AsymmetricSynchronic(sab, offset + _IQ_POP, isMaster, 0);
    this._latch = new AsymmetricSynchronic(sab, offset + _IQ_LATCH, isMaster, 0);
    if (isMaster) {
	Atomics.store(this._ia, _IQ_INSERT, 0);
	Atomics.store(this._ia, _IQ_REMOVE, 0);
    }
}

WorkerProducerIntQueue.BYTE_SIZE = _IQ_START;
WorkerProducerIntQueue.BYTE_ALIGN = AsymmetricSynchronic.BYTE_ALIGN;

WorkerProducerIntQueue.IMMEDIATE = AsymmetricSynchronic.IMMEDIATE;
WorkerProducerIntQueue.DELAYED = AsymmetricSynchronic.DELAYED;

WorkerProducerIntQueue.prototype.putOrFail = function (item) {
    this._checkAPI("putOrFail", false);

    let ia = this._ia;
    let latch = this._latch;

    while (latch.compareExchange(0,1) != 0)
	latch.waitUntilEquals(0);

    let insert = Atomics.load(ia, _IQ_INSERT);
    let remove = Atomics.load(ia, _IQ_REMOVE);
    let avail = insert < remove ? remove-insert : size-(insert-remove);

    if (avail < item.length + 1) {
	latch.store(0);
	return false;
    }

    let size = this._size;

    ia[_IQ_BASE + insert] = item.length;
    insert = (insert + 1) % size;
    for ( let i=0 ; i < item.length ; i++ ) {
	ia[_IQ_BASE + insert] = item[i];
	insert = (insert + 1) % size;
    }

    Atomics.store(ia, _IQ_INSERT, insert);
    this._pop.add(item.length + 1);
    latch.store(0);

    return true;
}

WorkerProducerIntQueue.prototype.put = function (item) {
    this._checkAPI("put", false);
    for (;;) {
	let oldpop = this._pop.load();
	if (putOrFail(item))
	    break;
	this._pop.waitUntilNotEquals(oldpop);
    }
}

WorkerProducerIntQueue.prototype.canTake = function () {
    this._checkAPI("canTake", true);
    return this._pop.load() > 0;
}

WorkerProducerIntQueue.prototype.takeOrFail = function () {
    this._checkAPI("takeOrFail", true);
    let ia = this._ia;
    let size = this._size;
    let insert = Atomics.load(ia, _IQ_INSERT);
    let remove = Atomics.load(ia, _IQ_REMOVE);
    if (insert == remove)
	return false;

    let n = ia[_IQ_BASE + remove];
    remove = (remove + 1) % size;
    for ( ; n > 0 ; n-- ) {
	item.push(ia[_IQ_BASE + remove]);
	remove = (remove + 1) % size;
    }

    Atomics.store(ia, _IQ_REMOVE, remove);
    this._pop.sub(item.length + 1);
    latch.store(0);

    return item;
}

WorkerProducerIntQueue.prototype.callWhenCanTake = function (callback) {
    this._checkAPI("callWhenCanTake", true);

    let check = (when) => {
	if (this._pop.load() == 0)
	    return this._pop.callWhenNotEquals(0, check);
	callback(when);
	return when == WorkerProducerIntQueue.IMMEDIATE;
    }

    return check(WorkerProducerIntQueue.IMMEDIATE);
}

WorkerProducerIntQueue.prototype._checkAPI = function(tag, onMaster) {
    if (onMaster != this._isMaster)
	throw new Error("WorkerProducerIntQueue API abuse: method '" + m + "' not available in " + (this._isMaster ? "master" : "worker"));
}

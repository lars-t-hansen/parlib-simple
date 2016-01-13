// Asymmetric bounded integer queue data types.
//
// MasterProducerIntQueue sends int32 bundles from the master to the
// workers.
//
// WorkerProducerIntQueue sends int32 bundles from the workers to the
// master.
//
// Data is communicated as bundles of int32 values (an "item").  The
// item is something that has a length property and responds to
// indexed getters.  When extracting data from the queue, the type
// returned is an Array.
//
//
// MasterProducerIntQueue producer API:
//
//  q.putOrFail(item) => true if the item was inserted, false if not
//  q.callWhenCanPut(itemSize, callback) => true if callback was invoked directly, otherwise false
//
// MasterProducerIntQueue consumer API:
//
//  q.canTake() => true if an item is available
//  q.takeOrFail() => item or null
//  q.take() => item, blocks until available
//
//
// WorkerProducerIntQueue producer API:
//
//  q.putOrFail(item) => boolean
//  q.put(item) => undefined, blocks until space is vailable
//
// WorkerProducerIntQueue consumer API:
//
//  q.canTake() => true if an item is available
//  q.takeOrFail() => item or null
//  q.callWhenCanTake(callback) => true if callbck was invoked directly, otherwise false


// Implementation:
//
// I is the insertion pointer: the circular buffer index of the first
// available slot past the last item.
//
// R is the removal pointer: the circular buffer index of the first
// element of the oldest item still in the buffer.
//
//   The buffer size bufsize is the number of data slots available.
//
//   Both I and R increase modulo bufsize.
//
//   The free capacity of a queue is R-I if R >= I and bufsize-(I-R)
//   otherwise.
//
// POP is a synchronic that is used for signaling insertions and
// removals, it has the count of items in the queue.  The producer
// increments POP when an item has been inserted; the consumer
// decrements it.  Consumers that find the queue empty and producers
// that find the queue at capacity can wait for updates to POP.
//
// The queue is empty if POP==0 or equivalently free==bufsize.
//
// LAT is a worker<->worker synchronic that's used as a latch to create
// a critical section for removal.  R is updated atomically, but only
// while the latch is held.
//
// Memory layout:
//                      I                                   R
// +------+-----------------------------------------------------------+
// |(meta)|ddddHdddddddd   --->                             HddddddHdd|
// +------------------------------------------------------------------+
//
// where meta contains I, R, POP, and WOR.

const _MPIQ_I   = 0;
const _MPIQ_R   = _MPIQ_I + 4;
const _MPIQ_POP = align(_MPIQ_R + 4, AsymmetricSynchronic.BYTE_ALIGN);
const _MPIQ_LAT = align(_MPIQ_POP + AsymmetricSynchronic.BYTE_SIZE, AsymmetricSynchronic.BYTE_ALIGN);
const _MPIQ_BUF = align(_MPIQ_LAT + AsymmetricSynchronic.BYTE_SIZE, 4);

const _MPIQ_INSERT = _MPQI_I >> 2;
const _MPIQ_REMOVE = _MPQI_R >> 2;
const _MPIQ_BASE   = _MPIQ_BUF >> 2;

function MasterProducerIntQueue(sab, offset, numBytes, isMaster) {
    this._size = (numBytes - MasterProducerIntQueue.BYTE_SIZE) >> 2;
    if (this._size <= 0)
	throw new Error("Buffer too small: " + numBytes);
    this._ia = new Int32Array(sab, offset, numBytes >> 2);
    this._pop = new AsymmetricSynchronic(sab, offset + _MPIQ_POP, isMaster, 0);
    this._latch = new AsymmetricSynchronic(sab, offset + _MPIQ_LAT, isMaster, 0);
    if (isMaster) {
	Atomics.store(this._ia, _MPIQ_INSERT, 0);
	Atomics.store(this._ia, _MPIQ_REMOVE, 0);
    }
}

/**
 * The amount of space needed for the MasterProducerQueue for its
 * internal data structures.  Any additional space should be divisible
 * by 4 (for integer data) and will be used for the buffer.
 */
MasterProducerIntQueue.BYTE_SIZE = _MPIQ_BUF;

/**
 * The required byte alignment, divisible by 4, no larger than 16.
 */
MasterProducerIntQueue.BYTE_ALIGN = AsymmetricSynchronic.BYTE_ALIGN;

// The implementation uses this equivalence.

MasterProducerIntQueue.IMMEDIATE = AsymmetricSynchronic.IMMEDIATE;
MasterProducerIntQueue.DELAYED = AsymmetricSynchronic.DELAYED;

/**
 * Master-only method.
 *
 * Insert the item if possible, and return true if so.  Otherwise
 * return false.
 */
MasterProducerIntQueue.prototype.putOrFail = function (item) {
    let buffer = this._buffer;
    let size = this._size;
    let insert = Atomics.load(buffer, this._INSERT);
    let remove = Atomics.load(buffer, this._REMOVE);
    let avail = insert <= remove ? remove-insert : size-(insert-remove);

    if (avail < item.length + 1)
	return false;

    buffer[_MPIQ_BASE + insert] = item.length;
    insert = (insert + 1) % size;
    for ( let i=0 ; i < item.length ; i++ ) {
	buffer[_MPIQ_BASE + insert] = item[i];
	insert = (insert + 1) % size;
    }

    this.pop.add(1);

    return true;
}

/**
 * Master-only method.
 *
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
    let buffer = this._buffer;
    let size = this._size;
    let pop = this._pop;
    let check = (when) => {
	let oldpop = pop.load();
	let insert = Atomics.load(buffer, _MPIQ_INSERT);
	let remove = Atomics.load(buffer, _MPIQ_REMOVE);
	let avail = insert <= remove ? remove-insert : size-(insert-remove);
	if (avail < itemSize + 1)
	    return pop.callWhenNotEquals(oldpop, check); // Not an ABA problem with one producer
	callback(when);
	return true;
    }
    return check(MasterProducerIntQueue.IMMEDIATE);
}

// Worker-only method
MasterProducerIntQueue.prototype.canTake = function () {
    return this._pop.load() > 0;
}

// Worker-only method
MasterProducerIntQueue.prototype.takeOrFail = function () {
    let buffer = this._buffer;
    let latch = this._latch;
    let insert = Atomics.load(buffer, _MPIQ_INSERT);
    while (latch.compareExchange(0,1) != 0)
	latch.waitUntilEquals(0);
    let remove = Atomics.load(buffer, _MPIQ_REMOVE);
    if (insert == remove) {
	latch.store(0);
	return false;
    }
    let n = buffer[_MPIQ_BASE + remove];
    let item = [];
    while (n > 0) {
	item.push(buffer[_MPIQ_BASE + remove]);
	remove = (remove + 1) % size;
    }
    Atomics.store(buffer, _MPIQ_REMOVE, remove);
    this.pop.sub(1);
    latch.store(0);
    return item;
}

// Worker-only method
MasterProducerIntQueue.prototype.take = function () {
    for (;;) {
	let item = this.takeOrFail();
	if (item)
	    return item;
	this.pop.waitUntilNotEquals(0);
    }
}

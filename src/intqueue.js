/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Simple multi-producer and multi-consumer shared-memory queue for
 * transmitting arrays of Int32 values - a useful building block for
 * other mechanisms.
 *
 * TODO: perhaps generalize this to bundles of same-typed elements.
 */

// REQUIRE
//   synchronic.js
//   arena.js

// Internal constants.
const _IQ_USED = 0;
const _IQ_HEAD = 1;
const _IQ_TAIL = 2;

/*
 * Construct an IntQueue object in any agent.
 *
 * sab must be a SharedArrayBuffer.
 * offset must be a valid offset within that array.
 * length must be the length of a segment within that array.
 * length-offset must have space for metadata and queue data.
 *   An upper bound on metadata is given by IntQueue.NUMBYTES.
 *
 * Constructors may be called concurrently in all agents provided the
 * memory that will be used has been zero-filled and the zeroes are
 * visible in the calling agent when the constructor is called.
 */
function IntQueue(sab, offset, length) {
    var intSize = 4;
    var synSize = SynchronicInt32.BYTES_PER_ELEMENT;
    var synAlign = SynchronicInt32.BYTE_ALIGNMENT;
    var a = new ArrayBufferArena(sab, offset, length);

    this._spaceAvailable = new SynchronicInt32(sab, a.alloc(synSize, synAlign));
    this._dataAvailable = new SynchronicInt32(sab, a.alloc(synSize, synAlign));
    this._lock = new SynchronicInt32(sab, a.alloc(synSize, synAlign));

    this._meta = new Int32Array(sab, a.alloc(intSize*3, intSize), 3);
    var qlen = Math.floor(a.available(intSize) / intSize);
    this._queue = new Int32Array(sab, a.alloc(intSize*qlen, intSize), qlen);
}

/*
 * The number of bytes needed for metadata (upper bound, allowing for
 * bad alignment etc).
 */
IntQueue.NUMBYTES = 64;

/*
 * Enters an element into the queue, waits until space is available or
 * until t milliseconds (undefined == indefinite wait) have passed.
 *
 * ints is a dense Array of Int32 values.
 * Returns true if it succeeded, false if it timed out.
 */
IntQueue.prototype.enqueue = function(ints, t) {
    var required = ints.length + 1;

    if (!this._acquireWithSpaceAvailable(required, t))
	return false;

    var q = this._queue;
    var qlen = q.length;
    var tail = this._meta[_IQ_TAIL];
    q[tail] = ints.length;
    tail = (tail + 1) % qlen;
    for ( var i=0 ; i < ints.length ; i++ ) {
	q[tail] = ints[i];
	tail = (tail + 1) % qlen;
    }
    this._meta[_IQ_TAIL] = tail;
    this._meta[_IQ_USED] += required;

    this._releaseWithDataAvailable();
    return true;
}

/*
 * Returns an element from the queue if there's one, or waits up to t
 * milliseconds (undefined == indefinite wait) for one to appear,
 * returning null if none appears in that time.
 *
 * The element is returned as a dense Array of Int32 values.
 */
IntQueue.prototype.dequeue = function (t) {
    if (!this._acquireWithDataAvailable(t))
	return null;

    var A = [];
    var q = this._queue;
    var qlen = q.length;
    var head = this._meta[_IQ_HEAD];
    var count = q[head];
    head = (head + 1) % qlen;
    while (count-- > 0) {
	A.push(q[head]);
	head = (head + 1) % qlen;
    }
    this._meta[_IQ_HEAD] = head;
    this._meta[_IQ_USED] -= A.length + 1;

    this._releaseWithSpaceAvailable();
    return A;
}

// Internal code below this point

IntQueue.prototype._acquireWithSpaceAvailable = function (required, t) {
    var limit = typeof t != "undefined" ? Date.now() + t : Number.POSITIVE_INFINITY;
    for (;;) {
	this._acquire();
	var length = this._queue.length;
	if (length - this._meta[_IQ_USED] >= required)
	    return true;
	var probe = this._spaceAvailable.load();
	this._release();
	if (required > length)
	    throw new Error("Queue will never accept " + required + " words");
	var remaining = limit - Date.now();
	if (remaining <= 0)
	    return false;
	this._spaceAvailable.expectUpdate(probe, remaining);
    }
}

IntQueue.prototype._acquireWithDataAvailable = function (t) {
    var limit = typeof t != "undefined" ? Date.now() + t : Number.POSITIVE_INFINITY;
    for (;;) {
	this._acquire();
	if (this._meta[_IQ_USED] > 0)
	    return true;
	var probe = this._dataAvailable.load();
	this._release();
	var remaining = limit - Date.now();
	if (remaining <= 0)
	    return false;
	this._dataAvailable.expectUpdate(probe, remaining);
    }
}

IntQueue.prototype._releaseWithSpaceAvailable = function() {
    this._spaceAvailable.add(1);
    this._release();
}

IntQueue.prototype._releaseWithDataAvailable = function() {
    this._dataAvailable.add(1);
    this._release();
}

// The locking protocol must not access the _meta data.

IntQueue.prototype._acquire = function () {
    while (this._lock.compareExchange(0, 1) != 0)
	this._lock.expectUpdate(1, Number.POSITIVE_INFINITY);
}

IntQueue.prototype._release = function () {
    this._lock.store(0);
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Simple queue of arrays of Int32 values - useful building block for
// many other mechanisms.
//
// REQUIRE
//   synchronic.js

// Internal constants.
const _IQ_USED = 0;
const _IQ_HEAD = 1;
const _IQ_TAIL = 2;

/*
 * Construct an IntQueue object in any agent.
 *
 * sab must be a SharedArrayBuffer.
 * offset must be a valid offset within that array, divisible by 8.
 * length must be the length of a segment within that array, divisible by 8.
 * length-offset must be at least IntQueue.NUMBYTES;
 *
 * If initialize==true then initialize the shared memory for the queue.
 * Constructors may be called concurrently in all threads but the queue
 * should not be used in any thread until the constructor that performs
 * the initialization has returned.
 */
function IntQueue(sab, offset, length, initialize) {
    if (!(sab instanceof SharedArrayBuffer &&
	  offset >= 0 && offset < sab.byteLength && offset % 8 == 0 &&
	  length >= 0 && offset + length <= sab.byteLength && length % 8 == 0 &&
	  length - offset >= IntQueue.NUMBYTES))
    {
	throw new Error("Bad queue parameters");
    }

    initialize = !!initialize;

    var alloc = offset;
    this._spaceAvailable = new SynchronicInt32(sab, alloc, initialize);
    alloc += SynchronicInt32.BYTES_PER_ELEMENT;
    this._dataAvailable = new SynchronicInt32(sab, alloc, initialize);
    alloc += SynchronicInt32.BYTES_PER_ELEMENT;
    this._lock = new SynchronicInt32(sab, alloc, initialize);
    alloc += SynchronicInt32.BYTES_PER_ELEMENT;
    this._meta = new SharedInt32Array(sab, alloc, 3);
    alloc += this._meta.length * SharedInt32Array.BYTES_PER_ELEMENT;
    var qlen = ((offset + length - alloc) & ~7) / SharedInt32Array.BYTES_PER_ELEMENT;
    this._queue = new SharedInt32Array(sab, alloc, qlen);

    if (initialize) {
	Atomics.store(this._meta, _IQ_USED, 0);
	Atomics.store(this._meta, _IQ_HEAD, 0);
	Atomics.store(this._meta, _IQ_TAIL, 0);
    }
}

/*
 * The number of bytes in the array reserved for metadata.
 */
IntQueue.NUMBYTES = (SynchronicInt32.BYTES_PER_ELEMENT*3 + SharedInt32Array.BYTES_PER_ELEMENT*3 + 7) & ~7;

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
    this._dataAvailable.add(1);

    this._release();
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
    this._spaceAvailable.add(1);

    this._release();
    return A;
}

// Internal code below this point

IntQueue.prototype._acquireWithSpaceAvailable = function (required, t) {
    var limit = typeof t != "undefined" ? Date.now() + t : Number.POSITIVE_INFINITY;
    for (;;) {
	this._acquire();
	var probe = this._spaceAvailable.load();
	if (this._queue.length - this._meta[_IQ_USED] >= required)
	    break;
	this._release();
	//print("Waiting for space");
	var remaining = limit - Date.now();
	if (remaining <= 0)
	    return false;
	this._dataAvailable.expectUpdate(probe, remaining);
    }
    return true;
}

IntQueue.prototype._acquireWithDataAvailable = function (t) {
    var limit = typeof t != "undefined" ? Date.now() + t : Number.POSITIVE_INFINITY;
    for (;;) {
	this._acquire();
	var probe = this._dataAvailable.load();
	if (this._meta[_IQ_USED] > 0)
	    break;
	this._release();
	var remaining = limit - Date.now();
	if (remaining <= 0)
	    return false;
	//print("Waiting for data " + probe + " " + this._dataAvailable.load() + " " + remaining);
	this._dataAvailable.expectUpdate(probe, remaining);
    }
    return true;
}

IntQueue.prototype._acquire = function () {
    while (this._lock.compareExchange(0, 1) != 0)
	this._lock.loadWhenEqual(0);
}

IntQueue.prototype._release = function () {
    this._lock.store(0);
}

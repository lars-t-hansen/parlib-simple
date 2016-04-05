/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Proof of concept: A simple asymmetric master/worker futex mechanism.
//
// In the master, create a MasterFutex for each shared array that
// we'll wait on.  In each worker, create corresponding WorkerFutexes.
//
// In the master's message event handler for each worker, be sure to
// call MasterFutex.dispatch as described below.
//
// The master can now provide nonblocking wait for signals from the
// workers.  There can be multiple pending waits and several waits can
// wait on the same location.
//
// See ../test/test-asymmetric-futex.html for example code.

"use strict";

// Desiderata / Facts of life:
//
//  - There can be multiple outstanding waits in the master, because
//    the master effectively multiplexes many threads of control
//  - Many of these waits can wait on the same location, but they can
//    also all wait on different locations
//  - There is only one master, normally the main thread.  Everyone else,
//    normally the workers, should use wait() for waiting
//  - The workers can use a dedicated wakeup to wake the master,
//    it need not be integrated with the normal wake()
//  - It is useful if the wait mechanism is like wait(), in that
//    it takes an expected value for an int32 cell
//
// Design:
//
//  - Each "cell" is two consecutive int32 locations, the first holds
//    the value and the second is a private coordination word which
//    must initially be zero
//  - The value location must only be accessed with atomic operations
//  - For each location - an (array,index) pair - the master keeps
//    track of callbacks to be invoked for a wakeup
//  - The coordination word consists of a count field and some flag
//    bits.  The count field tracks the number of waiters for which
//    a wakeup message has not been sent (some of the wakeups may
//    be pending).

const _WW_LOCK = 1;		// Lock flag
// Unused: 2
// Unused: 4
const _WW_MASK = 7;		// Mask bits for flags
const _WW_SHFT = 3;		// Shift to get count of waiters
const _WW_MAX = 0x0FFFFFFF;     // Max count value

const _OK = 0;
const _NOTEQUAL = -1;
const _TIMEDOUT = -2;

// Shared base class

function _MasterWorkerFutex() {}

_MasterWorkerFutex.prototype._lock = function (loc) {
    var a = 0;
    while ((a = Atomics.compareExchange(this._i32a, loc+1, a, a|_WW_LOCK)) & _WW_LOCK)
	;
    return a;
}

_MasterWorkerFutex.prototype._unlock = function (loc, a) {
    Atomics.store(this._i32a, loc+1, a);
}

_MasterWorkerFutex.prototype._signal = function (loc, count) {
    postMessage(["*concurrentsignal", this._id, loc, count]);
}

// The MasterFutex is used on the main thread.  i32a is an Int32Array
// on shared memory, id is any integer identifying that array.
//
// For each MasterFutex there is a corresponding WorkerFutex in each
// worker that needs it.  The WorkerFutex constructor must be passed
// an array starting at the same byte in shared memory and the same
// id.
//
// This constructor must return before a corresponding
// WorkerFutex.wake() is called in any worker.

function MasterFutex(i32a, id) {
    this._i32a = i32a;
    this._id = id;
    this._callbacks = {};
    if (MasterFutex._arrays[id])
	throw new Error("Duplicate array ID " + id);
    MasterFutex._arrays[id] = this;
}

MasterFutex.prototype = new _MasterWorkerFutex();

MasterFutex._arrays = {};

// In the master, client code must invoke MasterFutex.dispatch() on
// every message received from every worker.  The method will return
// true if it consumed the message, in which case the client must not
// process it further.

MasterFutex.dispatch = function (ev) {
    if (!(Array.isArray(ev.data) && ev.data.length == 4 && ev.data[0] == "*concurrentsignal"))
	return false;

    var [_, id, loc, count] = ev.data;
    if (!MasterFutex._arrays[id])
	throw new Error("Unknown array ID " + id);
    MasterFutex._arrays[id]._wakeup(loc, count);
    return true;
}

// Call wait() to wait on loc with callback cb if i32a[loc]==expected.
// Returns 0 if it is waiting, -1 if the values are unequal.

MasterFutex.prototype.wait = function (loc, expected, cb) {
    var r = _TIMEDOUT;
    var a = this._lock(loc);
    if (Atomics.load(this._i32a, loc) == expected) {
	r = _OK;
	this._callbacks[loc] = this._callbacks[loc] || [];
	this._callbacks[loc].push(cb);
	// TODO: Guard against overflow on the count field
	a += (1 << _WW_SHFT);
    }
    this._unlock(loc, a);
    return r;
};

// Private

MasterFutex.prototype._wakeup = function (loc, count) {
    var cb = this._callbacks[loc];
    if (!cb)
	return;
    while (cb.length && count-- > 0)
	(cb.shift())(_OK);
}

// Create a WorkerFutex to be used in the worker.  The arguments are
// as for MasterFutex, above.

function WorkerFutex(i32a, id) {
    this._i32a = i32a;
    this._id = id;
}

WorkerFutex.prototype = new _MasterWorkerFutex();

// Call wake() to send a wakeup signal to the master on loc.  count
// defaults to "all current waiters".

WorkerFutex.prototype.wake = function (loc, count) {
    var a = this._lock(loc);
    var num = Math.min(a >> _WW_SHFT, count === undefined ? _WW_MAX : (count|0));
    if (num > 0)
	this._signal(loc, num);
    this._unlock(loc, a - (num << _WW_SHFT));
}

// TODO:
//
// Implement a wait timeout, if a timeout then the callback should be
// invoked with -2 (the old TIMEDOUT value).  Note this will
// significantly complicate the protocol: if there is a wakeup message
// in transit for the timed-out waiter then that message must not wake
// count waiters, but count-1.  This may be fixable by replacing the
// timed-out waiter in the callbacks array with some sentinel value,
// so that we account for it properly.  But that leaves the question
// of how to manage the count of waiters.
//
// Alternatively, add MasterFutex.cancel(cb) so that client code can
// manage a timeout independently.  This does not remove the problem
// with in-transit wakeups.
//
// Optimize the code with an in-band signal, eg, Waiter.prototype.wait
// can recognize that there are wakeups in transit, and can invoke
// some pending callbacks directly.  This has at least the same
// complication as for the timeout, and additionally(?) we must track
// the number of in-transit signals.
//
// (Likely just having a count of in-transit wakeups per location is
// good enough, this doubles as high-water mark for the queue of
// callbacks.  If a canceled callback is within that range then the
// count of waiters should not be decremented; if it is outside the
// range the count must be decremented, and the item could even be
// removed.  The count of in-transit wakeups is decremented only by
// the dispatch code.  But - is there room for races here?)
//
// Can further optimize the in-band signal by spinning or
// micro-waiting on the "expected" value to be set.  This is more
// reasonably implemented as part of a synchronic abstraction though.
//
// An interesting optimization is that a wait on one location can run
// callbacks for in-transit wakeups also for other locations on that
// and other arrays.
//
// None of those optimizations may matter much in applications where
// only one wait() is outstanding, and those may be typical.  What
// might matter is a method on the MasterFutex (or even a static
// method on MasterFutex) to check for in-transit wakeups and run
// callbacks when appropriate; this can be used to improve
// responsiveness in longer-running main-thread loops.

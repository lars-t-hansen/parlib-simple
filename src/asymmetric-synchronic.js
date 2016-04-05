/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Simple asymmetric "synchronics" (shared cells)
 * 2016-01-13 / lhansen@mozilla.com
 *
 * A synchronic is a shared atomic cell that agents (workers or the
 * "master" main thread) can be notified of updates to.
 *
 * In an "asymmetric" synchronic as defined here, the workers and the
 * master handle the notification differently: the worker will block
 * waiting for an update, while the master must wait for a callback.
 * It is implemented this way so that the master can avoid blocking.
 *
 * Synchronics provide a simple value-signaling mechanism and are good
 * building blocks for more complex data structures.
 *
 *
 * Note that in a system such as a web browser the master has an
 * unbounded number of "threads" that are cooperatively scheduled:
 * such a "thread" is suspended by setting up a callback that
 * continues the thread, and then returning to the event loop.  (With
 * Promises and especially async/await this is fairly obvious.)  In
 * that scenario one thread in the master may come to interact with
 * another through a synchronic.
 *
 * The AsymmetricSynchronic defined here allows for signaling from the
 * master to the workers, from the workers to the master, individually
 * among the workers, and from one master "thread" to another.  If any
 * agent updates the value, all listeners are woken.  Notably, the
 * master can register multiple callbacks on a synchronic and they are
 * all invoked when a signal is returned.
 *
 * Worker-to-worker and master-to-worker communication is generally
 * quick, as it's just a wake() call.  Worker-to-master and
 * master-to-master communication is fairly slow, because actual
 * messages must be sent to the master and must be dispatched in the
 * master event loop.
 */

/* IMPORTANT USAGE NOTE:
 *
 * Message events are being used to signal the master.  For this to work,
 * the client must be sure to route Message events to the Synchronic
 * subsystem.  See comments at AsymmetricSynchronic.filterEvent(), below.
 */

"use strict";

// Private constants.

const _AS_SIZE = 20;
const _AS_ALIGN = 4;

const _AS_VAL = 0;		// Value
const _AS_NUMWAIT = 1;		// Number of workers waiting
const _AS_SEQ = 2;		// Sequence number for waiting workers
const _AS_WAITBITS = 3;		// Flags for waiting master
const _AS_ID = 4;		// ID for message to master

const _AS_WAITFLAG = 1;		// Master is waiting
const _AS_TRANSITFLAG = 2;	// Message is already in transit

const _AS_NOTIFYMSG = "AsymmetricSynchronic*notify";

// Private utilities

const _now =
      (typeof "performance" != "undefined" && typeof performance.now == "function" ?
       performance.now.bind(performance) :
       Date.now.bind(Date));

const _setTimeout =
      (this.setTimeout ?
       this.setTimeout :
       function (cb, timeout) {
	   throw new Error("No timeouts available");
       });

const _cleanTimeout =
      function (t) {
	  if (typeof t != "number" || isNaN(t) || t < 0)
	      return Number.POSITIVE_INFINITY;
	  return +t;
      };

const _postMessageMasterToMaster = function (datum) {
    window.dispatchEvent(new MessageEvent("message", {data: datum}));
}

/**
 * Create an AsymmetricSynchronic.
 *
 * Use the same constructor in both master and workers.  Both sides
 * must pass the same sab and offset arguments.
 *
 * - "sab" is a SharedArrayBuffer.
 * - "offset" is an offset within "sab" on a boundary according
 *    to AsymmetricSynchronic.BYTE_ALIGN.
 * - "isMaster" must be true iff the master is constructing the object
 * - "init" is the optional initial value for the cell (master only)
 *
 * The cell will occupy AsymmetricSynchronic.BYTE_SIZE bytes within
 * "sab" starting at "offset"; do not use those for anything else.
 */
function AsymmetricSynchronic(sab, offset, isMaster_, init) {
    let ia = new Int32Array(sab, offset, _AS_SIZE/4);
    let isMaster = !!isMaster_;
    if (isMaster) {
	let id = AsymmetricSynchronic._idents++;
	Atomics.store(ia, _AS_VAL, init);
	Atomics.store(ia, _AS_NUMWAIT, 0);
	Atomics.store(ia, _AS_SEQ, 0);
	Atomics.store(ia, _AS_WAITBITS, 0);
	Atomics.store(ia, _AS_ID, id);
	AsymmetricSynchronic._callbacks[id] = null;
	this._id = id;
    }
    this._isMaster = isMaster;
    this._ia = ia;
}

/**
 * Size reserved within the SharedArrayBuffer for a
 * AsymmetricSynchronic object.  Will be divisible by 4.
 */
AsymmetricSynchronic.BYTE_SIZE = _AS_SIZE;

/**
 * Required alignment within the SharedArrayBuffer for a
 * AsymmetricSynchronic object.  Will be 4, 8, or 16.
 */
AsymmetricSynchronic.BYTE_ALIGN = _AS_ALIGN;

/**
 * The value passed to a callback if it was invoked immediately (not
 * delayed).  An int32 value.
 */
AsymmetricSynchronic.IMMEDIATE = -1;

/**
 * The value passed to a callback if the wait timed out.  An int32
 * value.
 */
AsymmetricSynchronic.TIMEDOUT = -2;

/**
 * The value passed to a callback if it was not invoked immediately
 * and did not time out.  An int32 value.
 */
AsymmetricSynchronic.DELAYED = -3;

/**
 * A function to invoke on a Message event that is received in the
 * Master.  If this function returns true the AsymmetricSynchronic
 * consumed the event and the master must ensure that its own code
 * does not process the event.
 */
AsymmetricSynchronic.filterEvent = function (ev) {
    if (Array.isArray(ev.data) && ev.data.length >= 2 && ev.data[0] === _AS_NOTIFYMSG) {
	ev.data[0] = "";
	this._dispatchCallback(ev.data[1], AsymmetricSynchronic.DELAYED);
	return true;
    }
    return false;
}

// Private properties and methods

AsymmetricSynchronic._callbacks = {};
AsymmetricSynchronic._idents = 1;

// Note, having multiple outstanding callbacks gets in the way of the
// message optimization suggested above _callWhenValueChanges(),
// below, which wants there to be at most one callback.  There are
// probably reasonable compromises for that, but that's future work.
// For now, allowing multiple callbacks is least surprising and is
// required for master-to-master signaling to work.

AsymmetricSynchronic._registerCallback = function(swu, cb, timeout) {
    let id = swu._id;
    if (!this._callbacks[id])
	this._callbacks[id] = [];
    this._callbacks[id].push(cb);
    if (isFinite(timeout)) {
	_setTimeout(() => this._dispatchCallback(id, AsymmetricSynchronic.TIMEDOUT),
		    timeout);
    }
}

AsymmetricSynchronic._dispatchCallback = function (id, why) {
    let cbs = this._callbacks[id];
    if (!cbs)
	return;
    this._callbacks[id] = null;
    for ( let i=0 ; i < cbs.length ; i++ )
	cbs[i](why);
}

/**
 * Atomically read the current value of the cell.
 */
AsymmetricSynchronic.prototype.load = function () {
    return Atomics.load(this._ia, _AS_VAL);
}

/**
 * Atomically update the value of the cell to v and notify any
 * listeners.
 */
AsymmetricSynchronic.prototype.store = function (v) {
    let val = v|0;
    Atomics.store(this._ia, _AS_VAL, val);
    this._notify();
    return val;
}

/**
 * Atomically compare the value in the cell to oldv, and if they are
 * equal store newv in the cell and notify any listeners.
 */
AsymmetricSynchronic.prototype.compareExchange = function (oldv, newv) {
    let oldval = oldv|0;
    let newval = newv|0;
    let result = Atomics.compareExchange(this._ia, _AS_VAL, oldval, newval);
    if (result == oldval)
	this._notify();
    return result;
}

/**
 * Atomically add v to the value of the cell and notify any listeners.
 */
AsymmetricSynchronic.prototype.add = function (v) {
    let val = v|0;
    let result = Atomics.add(this._ia, _AS_VAL, val);
    this._notify();
    return result;
}

// Ditto sub, and, or, xor, exchange

AsymmetricSynchronic.prototype.sub = function (v) {
    let val = v|0;
    let result = Atomics.sub(this._ia, _AS_VAL, val);
    this._notify();
    return result;
}

AsymmetricSynchronic.prototype.and = function (v) {
    let val = v|0;
    let result = Atomics.and(this._ia, _AS_VAL, val);
    this._notify();
    return result;
}

AsymmetricSynchronic.prototype.or = function (v) {
    let val = v|0;
    let result = Atomics.or(this._ia, _AS_VAL, val);
    this._notify();
    return result;
}

AsymmetricSynchronic.prototype.xor = function (v) {
    let val = v|0;
    let result = Atomics.xor(this._ia, _AS_VAL, val);
    this._notify();
    return result;
}

AsymmetricSynchronic.prototype.exchange = function (v) {
    let val = v|0;
    let result = Atomics.exchange(this._ia, _AS_VAL, val);
    this._notify();
    return result;
}

/**
 * Notify any listeners to wake up and re-check their conditions.
 */
AsymmetricSynchronic.prototype.notify = function () {
    this._notify();
}

/**
 * Master-only API:
 *
 * Examine the value in the cell and invoke callback when the cell
 * value is found not to be v or when the call times out after t
 * milliseconds.
 *
 * When the callback is invoked it is invoked with one of three
 * values: AsymmetricSynchronic.TIMEDOUT if there was a timeout,
 * AsymmetricSynchronic.DELAYED if the callback was not performed
 * immediately, and AsymmetricSynchronic.IMMEDIATE if the callback was
 * performed immediately.
 *
 * callWhenUpdated() returns true if the callback was invoked
 * immediately, otherwise false.
 */
AsymmetricSynchronic.prototype.callWhenUpdated = function (value_, callback, timeout_) {
    this._checkAPI(true, "callWhenUpdated");

    let value = value_|0;
    let timeout = _cleanTimeout(timeout_);
    let now = _now();
    let limit = now + timeout;
    let ia = this._ia;

    let check = (why) => {
	let v = Atomics.load(ia, _AS_VAL);
	if (v !== value) {
	    Atomics.store(ia, _AS_WAITBITS, 0);
	    callback(why);
	    return why == AsymmetricSynchronic.IMMEDIATE;
	}
	now = _now();
	if (now >= limit) {
	    Atomics.store(ia, _AS_WAITBITS, 0);
	    callback(AsymmetricSynchronic.TIMEDOUT);
	    return false;
	}
	Atomics.store(ia, _AS_WAITBITS, _AS_WAITFLAG);
	return AsymmetricSynchronic._registerCallback(this, check, limit - now);
    }

    return check(AsymmetricSynchronic.IMMEDIATE);
}

/**
 * Master-only API:
 *
 * Examine the value in the cell and invoke callback when the cell
 * value is found not to be v.  Returns true if the callback was
 * invoked directly, otherwise false.
 *
 * Values passed to the callback are as for callWhenUpdated(), above.
 */
AsymmetricSynchronic.prototype.callWhenEquals = function (v, callback) {
    this._checkAPI(true, "callWhenEquals");
    return this._callWhenValueChanges(v, callback, true);
}

/**
 * Master-only API:
 *
 * Examine the value in the cell and invoke callback when the cell
 * value is found to be v.  Returns true if the callback was invoked
 * directly, otherwise false.
 *
 * Values passed to the callback are as for callWhenUpdated(), above.
 */
AsymmetricSynchronic.prototype.callWhenNotEquals = function (v, callback) {
    this._checkAPI(true, "callWhenNotEquals");
    return this._callWhenValueChanges(v, callback, false);
}

/**
 * Worker-only API:
 *
 * Examine the value in the cell and if it is v block until it becomes
 * something other than v or until the timeout t (milliseconds) expires.
 */
AsymmetricSynchronic.prototype.expectUpdate = function (value_, timeout_) {
    this._checkAPI(false, "expectUpdate");
    let value = value_|0;
    let timeout = _cleanTimeout(timeout_);
    let now = _now();
    let limit = now + timeout;
    let ia = this._ia;
    for (;;) {
	let tag = Atomics.load(ia, _AS_SEQ);
	let v = Atomics.load(ia, _AS_VAL) ;
	if (v !== value || now >= limit)
	    break;
	this._waitForUpdate(tag, limit - now);
	now = _now();
    }
}

/**
 * Worker-only API:
 *
 * Examine the value in the cell and if it is not v block until it
 * becomes v.  Returns the value that was observed.
 */
AsymmetricSynchronic.prototype.waitUntilEquals = function (v) {
    this._checkAPI(false, "waitUntilEquals");
    return this._waitOnValue(v, true);
}

/**
 * Worker-only API:
 *
 * Examine the value in the cell and if it is v block until it becomes
 * something other than v.  Returns the value that was observed.
 */
AsymmetricSynchronic.prototype.waitUntilNotEquals = function (v) {
    this._checkAPI(false, "waitUntilNotEquals");
    return this._waitOnValue(v, false);
}

// Private methods

AsymmetricSynchronic.prototype._checkAPI = function (requireMaster, m) {
    if (this._isMaster != requireMaster)
	throw new Error("AsymmetricSynchronic API abuse: method '" + m + "' not available in " + (this._isMaster ? "master" : "worker"));
}

AsymmetricSynchronic.prototype._waitOnValue = function (value_, equals) {
    let value = value_|0;
    let ia = this._ia;
    for (;;) {
	let oldval = Atomics.load(ia, _AS_SEQ);
	let v = Atomics.load(ia, _AS_VAL) ;
	if (equals ? v === value : v !== value)
	    return v;
	this._waitForUpdate(oldval, Number.POSITIVE_INFINITY);
    }
}

// This is the same as callWhenUpdated() - it signals the master - but
// arguably not very efficient for signals that aren't simply 0 or 1.
// Suppose the master is waiting for a counter to reach a certain
// value.  The workers will decrement the counter in turn.  If message
// delivery is fast and the worker processes the message quickly, the
// message for one decrement may have been consumed by the time the
// next decrement happens, at which point yet another message is sent
// off.
//
// To do better we have to store the condition for sending the message
// (equal/not equal, and the trigger value) in the cell and have the
// updating worker check it before sending.  It should still be legal
// to send too many messages - the master must check the condition
// even with that optimization - but it would reduce the number of
// messages in the master.
//
// That optimization conflicts somewhat with allowing multiple master
// "threads" to wait, see comments at _registerCallback() above.  At
// the moment, that feature takes precedence over performance here.

AsymmetricSynchronic.prototype._callWhenValueChanges = function (value_, callback, equals) {
    let value = value_|0;
    let ia = this._ia;

    let check = (why) => {
	let v = Atomics.load(ia, _AS_VAL);
	if (equals ? v === value : v !== value) {
	    Atomics.store(ia, _AS_WAITBITS, 0);
	    callback(why);
	    return why == AsymmetricSynchronic.IMMEDIATE;
	}
	Atomics.store(ia, _AS_WAITBITS, _AS_WAITFLAG);
	return AsymmetricSynchronic._registerCallback(this, check, Number.POSITIVE_INFINITY);
    }

    return check(AsymmetricSynchronic.IMMEDIATE);
}

AsymmetricSynchronic.prototype._notify = function () {
    this._notifyToWorkers();
    this._notifyToMaster();
}

AsymmetricSynchronic.prototype._notifyToMaster = function () {
    let ia = this._ia;
    let r = 0;
    if ((r = Atomics.compareExchange(ia, _AS_WAITBITS,
				     _AS_WAITFLAG,
				     _AS_WAITFLAG|_AS_TRANSITFLAG)) == _AS_WAITFLAG)
    {
	let id = Atomics.load(ia, _AS_ID);
	if (this._isMaster)
	    _postMessageMasterToMaster([_AS_NOTIFYMSG, id]);
	else
	    postMessage([_AS_NOTIFYMSG, id]);
    }
}

AsymmetricSynchronic.prototype._notifyToWorkers = function () {
    let ia = this._ia;
    Atomics.add(ia, _AS_SEQ, 1);
    let waiters = Atomics.load(ia, _AS_NUMWAIT);
    if (waiters > 0)
	Atomics.wake(ia, _AS_SEQ, waiters);
}

AsymmetricSynchronic.prototype._waitForUpdate = function (tag, timeout) {
    let ia = this._ia;
    Atomics.add(ia, _AS_NUMWAIT, 1);
    Atomics.wait(ia, _AS_SEQ, tag, timeout);
    Atomics.sub(ia, _AS_NUMWAIT, 1);
}

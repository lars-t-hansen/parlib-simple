/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Simple asymmetric "synchronics" (shared cells)
// 2016-01-11 / lhansen@mozilla.com

// Synchronics provide a simple value-signaling mechanism and are good
// building blocks for more complex data structures.  The synchronics
// defined here are for mainthread<->worker communication, which is
// awkward to do because the main thread can't block; for simple
// worker<->worker communication see synchronic.js.

// There are two asymmetric-synchronic types, SynchronicMasterUpdates
// and SynchronicWorkerUpdates (SMU and SWU for short).  In a SMU the
// master updates the cell and the the workers listens for updates; in
// a SWU the workers update the cell and the master listens for
// updates.  This split has been made for the sake of simplicity, in
// the expectation that it serves realistic asymmetric use cases well
// enough.
//
// This implementation supports only Int32, and it has a limited API,
// but it generalizes.
//
// In both SMU and SWU, both the master and the workers can read the
// current value of the cell with the load() method.

// Demos, test cases:
//  - ../test/test-asymmetric-synchronic.html and its JS files

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


//////////////////////////////////////////////////////////////////////
//
// SynchronicMasterUpdates.

// Private constants.

const _SMU_SIZE = 12;
const _SMU_ALIGN = 4;

const _SMU_VAL = 0;
const _SMU_NUMWAIT = 1;
const _SMU_SEQ = 2;

/**
 * Create a SynchronicMasterUpdates.
 *
 * Use the same constructor in both master and workers.  Both sides
 * must pass the same sab and offset arguments.
 *
 * - "sab" is a SharedArrayBuffer.
 * - "offset" is an offset within "sab" on a boundary according
 *    to SynchronicMasterUpdates.BYTE_ALIGN.
 * - "isMaster" must be true when the master constructs the object
 * - "init" is the optional initial value for the cell
 *
 * The cell will own SynchronicMasterUpdates.BYTE_SIZE bytes within
 * "sab" starting at "offset".
 */
function SynchronicMasterUpdates(sab, offset, isMaster_, init) {
    let ia = new Int32Array(sab, offset, _SMU_SIZE/4);
    let isMaster = !!isMaster_;
    if (isMaster) {
	Atomics.store(ia, _SMU_VAL, init);
	Atomics.store(ia, _SMU_NUMWAIT, 0);
	Atomics.store(ia, _SMU_SEQ, 0);
    }
    this._isMaster = isMaster;
    this._ia = ia;
}

/**
 * Size reserved within the SharedArrayBuffer for a
 * SynchronicMasterUpdates object.  Will be divisible by 4.
 */
SynchronicMasterUpdates.BYTE_SIZE = _SMU_SIZE;

/**
 * Required alignment within the SharedArrayBuffer for a
 * SynchronicMasterUpdates object.  Will be divisible by 4; will be at
 * most 16.
 */
SynchronicMasterUpdates.BYTE_ALIGN = _SMU_ALIGN;

/**
 * Atomically read the current value of the cell.  Both master and
 * worker can call this.
 */
SynchronicMasterUpdates.prototype.load = function () {
    return Atomics.load(this._ia, _SMU_VAL);
}

/**
 * Atomically update the value of the cell to v and notify any listening
 * workers.  Only the master can call this.
 */
SynchronicMasterUpdates.prototype.store = function (v) {
    this._checkAPI(true, "store");
    let val = v|0;
    Atomics.store(this._ia, _SMU_VAL, val);
    this._notify();
    return val;
}

/**
 * Atomically compare the value in the cell to oldv, and if they are
 * equal store newv in the cell and notify any listening workers.
 * Only the master can call this.
 */
SynchronicMasterUpdates.prototype.compareExchange = function (oldv, newv) {
    this._checkAPI(true, "compareExchange");
    let oldval = oldv|0;
    let newval = newv|0;
    let result = Atomics.compareExchange(this._ia, _SMU_VAL, oldval, newval);
    if (result == oldval)
	this._notify();
    return result;
}

/**
 * Atomically add v to the value of the cell and notify any listening
 * workers.  Only the master can call this.
 */
SynchronicMasterUpdates.prototype.add = function (v) {
    this._checkAPI(true, "add");
    let val = v|0;
    let result = Atomics.add(this._ia, _SMU_VAL, val);
    this._notify();
    return result;
}

/**
 * Notify any listening workers.  Only the master can call this.
 */
SynchronicMasterUpdates.prototype.notify = function () {
    this._checkAPI(true, "notify");
    this._notify();
}

/**
 * Examine the value in the cell and if it is v block until it becomes
 * something other than v, or until the timeout t (milliseconds)
 * expires.  Only the worker can call this.
 */
SynchronicMasterUpdates.prototype.expectUpdate = function (value_, timeout_) {
    this._checkAPI(false, "expectUpdate");
    let value = value_|0;
    let timeout = +timeout_;
    let now = _now();
    let limit = now + timeout;
    let ia = this._ia;
    for (;;) {
	let tag = Atomics.load(ia, _SMU_SEQ);
	let v = Atomics.load(ia, _SMU_VAL) ;
	if (v !== value || now >= limit)
	    break;
	this._waitForUpdate(tag, limit - now);
	now = _now();
    }
}

/**
 * Examine the value in the cell and if it is not v block until it
 * becomes v.  Returns the value that was observed (ie, v, modulo
 * conversions).  Only the worker can call this.
 */
SynchronicMasterUpdates.prototype.waitUntilEquals = function (v) {
    this._checkAPI(false, "waitUntilEquals");
    return this._waitOnValue(v, true);
}

/**
 * Examine the value in the cell and if it is v block until it becomes
 * something other than v.  Returns the value that was observed.  Only
 * the worker can call this.
 */
SynchronicMasterUpdates.prototype.waitUntilNotEquals = function (v) {
    this._checkAPI(false, "waitUntilEquals");
    return this._waitOnValue(v, false);
}

/**
 * (Somewhat experimental.)
 *
 * Update the cell from the worker without notifying anyone.  This is used
 * to consume a value that was sent through the cell and allows the cell to
 * be used for richer behavior.  Only the worker can call this.
 */
SynchronicMasterUpdates.prototype.storeNoNotify = function (v) {
    this._checkAPI(false, "storeNoNotify");
    let val = v|0;
    Atomics.store(this._ia, _SMU_VAL, val);
    return val;
}

// Ditto.
SynchronicMasterUpdates.prototype.addNoNotify = function (v) {
    this._checkAPI(false, "addNoNotify");
    let val = v|0;
    return Atomics.add(this._ia, _SMU_VAL, val);
}

// Ditto.
SynchronicMasterUpdates.prototype.compareExchangeNoNotify = function (oldv, newv) {
    this._checkAPI(false, "compareExchangeNoNotify");
    let oldval = oldv|0;
    let newval = newv|0;
    return Atomics.compareExchange(this._ia, _SMU_VAL, oldval, newval);
}

// Private methods

SynchronicMasterUpdates.prototype._checkAPI = function (requireMaster, m) {
    if (this._isMaster != requireMaster)
	throw new Error("SynchronicMasterUpdates API abuse: method '" + m + "' not available in " + (this._isMaster ? "master" : "worker"));
}

SynchronicMasterUpdates.prototype._waitOnValue = function (v, equals) {
    let value = v|0;
    let ia = this._ia;
    let v = 0;
    for (;;) {
	let tag = Atomics.load(ia, _SMU_SEQ);
	v = Atomics.load(ia, _SMU_VAL) ;
	if (equals ? v === value : v !== value)
	    return v;
	this._waitForUpdate(tag, Number.POSITIVE_INFINITY);
    }
}

SynchronicMasterUpdates.prototype._notify = function () {
    let ia = this._ia;
    Atomics.add(ia, _SMU_SEQ, 1);
    let waiters = Atomics.load(ia, _SMU_NUMWAIT);
    if (waiters > 0)
	Atomics.futexWake(ia, _SMU_SEQ, waiters);
}

SynchronicMasterUpdates.prototype._waitForUpdate = function (tag, timeout) {
    let ia = this._ia;
    Atomics.add(ia, _SMU_NUMWAIT, 1);
    Atomics.futexWait(ia, _SMU_SEQ, tag, timeout);
    Atomics.sub(ia, _SMU_NUMWAIT, 1);
}

//////////////////////////////////////////////////////////////////////
//
// SynchronicWorkerUpdates.
//

// Private constants.

const _SWU_SIZE = 12;
const _SWU_ALIGN = 4;

const _SWU_VAL = 0;
const _SWU_WAITBITS = 1;
const _SWU_ID = 2;

const _SWU_WAITFLAG = 1;
const _SWU_TRANSITFLAG = 2;

const _SWU_NOTIFYMSG = "SynchronicWorkerUpdates*notify";

/**
 * Create a SynchronicWorkerUpdates.
 *
 * Use the same constructor in both master and workers.  Both sides
 * must pass the same sab and offset arguments.
 *
 * - "sab" is a SharedArrayBuffer.
 * - "offset" is an offset within "sab" on a boundary according
 *   to SynchronicWorkerUpdates.BYTE_ALIGN.
 * - "isMaster" must be true when the master constructs the object
 * - "init" is the optional initial value for the cell
 *
 * The cell will own SynchronicWorkerUpdates.BYTE_SIZE bytes within
 * "sab" starting at "offset".
 *
 * Important usage notes:
 *
 * (1) The client code in the Master MUST install an event handler for
 * the "message" event; when that handler receives an event object
 * "ev" it MUST call SynchronicWorkerUpdates.filterEvent(ev); if the
 * latter function returns true the master MUST NOT process the event
 * itself in any way.  filterEvent() will alter the event object so
 * that it will consume it only once.
 *
 * (2) This SynchronicWorkerUpdates type can only have one outstanding
 * callback at a time (per SWU object).  An event-driven master is
 * effectively cooperatively multithreaded (and with async/await this
 * becomes obvious), and so it would be possible for several "threads"
 * in the master to all wait for an update to a single cell at the
 * same time.  We disallow that, for the sake of simplicity.
 */
function SynchronicWorkerUpdates(sab, offset, isMaster_, init) {
    let ia = new Int32Array(sab, offset, _SWU_SIZE/4);
    let isMaster = !!isMaster_;
    if (isMaster) {
	let id = SynchronicWorkerUpdates._idents++;
	Atomics.store(ia, _SWU_VAL, init);
	Atomics.store(ia, _SWU_WAITBITS, 0);
	Atomics.store(ia, _SWU_ID, id);
	SynchronicWorkerUpdates._callbacks[id] = null;
	this._id = id;
    }
    this._isMaster = isMaster;
    this._ia = ia;
}

/**
 * Size reserved within the SharedArrayBuffer for a
 * SynchronicWorkerUpdates object.  Will be divisible by 4.
 */
SynchronicWorkerUpdates.BYTE_SIZE = _SWU_SIZE;

/**
 * Required alignment within the SharedArrayBuffer for a
 * SynchronicWorkerUpdates object.  Will be divisible by 4; will be at
 * most 16.
 */
SynchronicWorkerUpdates.BYTE_ALIGN = _SWU_ALIGN;

/**
 * The value passed to a callback if it was invoked immediately (not
 * delayed).  An int32 value.
 */
SynchronicWorkerUpdates.IMMEDIATE = -1;

/**
 * The value passed to a callback if the wait timed out.  An int32
 * value.
 */
SynchronicWorkerUpdates.TIMEDOUT = -2;

/**
 * The value passed to a callback if it was not invoked immediately
 * and did not time out.  An int32 value.
 */
SynchronicWorkerUpdates.DELAYED = -3;

/**
 * A function to invoke on a Message event that is received in the
 * Master.  If this function returns true the SynchronicWorkerUpdates
 * consumed the event and the master must ensure that its own code
 * does not process the event.
 */
SynchronicWorkerUpdates.filterEvent = function (ev) {
    if (Array.isArray(ev.data) && ev.data.length >= 2 && ev.data[0] === _SWU_NOTIFYMSG) {
	ev.data[0] = "";
	this._dispatchCallback(ev.data[1]);
	return true;
    }
    return false;
}

// Private properties and methods

SynchronicWorkerUpdates._callbacks = {};
SynchronicWorkerUpdates._idents = 1;

// It is not hard to allow multiple outstanding callbacks here; we
// would simply have a list of callbacks per ID, and when a message is
// delivered we would unhook the list and call all the callbacks in
// turn right here.
//
// However, that feature probably gets in the way of the message
// optimization explained above _callWhenValueChanges(), below, which
// wants there to be at most one callback.  There are probably
// reasonable compromises for that, but that's fodder for a future
// explanation.

SynchronicWorkerUpdates._registerCallback = function(swu, cb, timeout) {
    let id = swu._id;
    if (this._callbacks[id])
	throw new Error("Callback already live on a SynchronicWorkerUpdates");
    this._callbacks[id] = cb;
    if (timeout != Number.POSITIVE_INFINITY && !isNaN(timeout)) {
	console.log("Setting timeout " + timeout);
	_setTimeout(() => this._dispatchCallback(id), timeout);
    }
}

SynchronicWorkerUpdates._dispatchCallback = function (id) {
    let cb = this._callbacks[id];
    // This can happen when a timeout and a wakeup race.
    if (!cb)
	return;
    this._callbacks[id] = null;
    cb();
}

/**
 * Atomically read the current value of the cell.  Both master and
 * worker can call this.
 */
SynchronicWorkerUpdates.prototype.load = function () {
    return Atomics.load(this._ia, _SWU_VAL);
}

/**
 * Atomically update the value of the cell to v and notify the master
 * if it is listening.  Only the workers can call this.
 */
SynchronicWorkerUpdates.prototype.store = function (v) {
    this._checkAP(false, "store");
    let val = v|0;
    Atomics.store(this._ia, _SWU_VAL, val);
    this._notify();
    return val;
}

/**
 * Atomically compare the value in the cell to oldv, and if they are
 * equal store newv in the cell and notify the master if it is
 * listening.  Only the workers can call this.
 */
SynchronicWorkerUpdates.prototype.compareExchange = function (oldv, newv) {
    this._checkAPI(false, "compareExchange");
    let oldval = oldv|0;
    let newval = newv|0;
    let result = Atomics.compareExchange(this._ia, _SWU_VAL, oldval, newval);
    if (result == oldval)
	this._notify();
    return result;
}

/**
 * Atomically add v to the value of the cell and notify the master if
 * it is listening.  Only the workers can call this.
 */
SynchronicWorkerUpdates.prototype.add = function (v) {
    this._checkAPI(false, "add");
    let val = v|0;
    let result = Atomics.add(this._ia, _SWU_VAL, val);
    this._notify();
    return result;
}

/**
 * Notify the master if it is listening.  Only the workers can call
 * this.
 */
SynchronicWorkerUpdates.prototype.notify = function () {
    this._checkAPI(false, "notify");
    this._notify();
}


/**
 * Examine the value in the cell and invoke callback when the cell
 * value is found not to be v, or when the call times out after t
 * milliseconds.  Only the master can call this.
 *
 * When the callback is invoked it is invoked with one of three
 * values: SWU.TIMEDOUT if there was a timeout, SWU.DELAYED if the
 * callback was not performed immediately, and SWU.IMMEDIATE if the
 * callback was performed immediately.
 *
 * callWhenUpdated returns true if the callback was performed
 * immediately, otherwise false.
 */
SynchronicWorkerUpdates.prototype.callWhenUpdated = function (value_, callback, timeout_) {
    this._checkAPI(true, "callWhenUpdated");

    let value = value_|0;
    let timeout = +timeout_;
    let now = _now();
    let limit = now + timeout;
    let ia = this._ia;
    let firstTime = true;

    let check = () => {
	let v = Atomics.load(ia, _SWU_VAL);
	if (v !== value) {
	    Atomics.store(ia, _SWU_WAITBITS, 0);
	    callback(firstTime ? SynchronicWorkerUpdates.IMMEDIATE : SynchronicWorkerUpdates.DELAYED);
	    return firstTime;
	}
	now = _now();
	if (now >= limit) {
	    Atomics.store(ia, _SWU_WAITBITS, 0);
	    callback(SynchronicWorkerUpdates.DELAYED);
	    return false;
	}
	firstTime = false;
	Atomics.store(ia, _SWU_WAITBITS, _SWU_WAITFLAG);
	return SynchronicWorkerUpdates._registerCallback(this, check, limit - now);
    }

    return check();
}

/**
 * Examine the value in the cell and invoke callback when the cell
 * value is found not to be v.  Only the master can call this.
 * Returns true if the callback was invoked directly, otherwise false.
 * Only the master can call this.
 *
 * Values passed to the callback are as for callWhenUpdated(), above.
 */
SynchronicWorkerUpdates.prototype.callWhenEquals = function (v, callback) {
    this._checkAPI(true, "callWhenEquals");
    return this._callWhenValueChanges(v, callback, true);
}

/**
 * Examine the value in the cell and invoke callback when the cell
 * value is found to be v.  Only the master can call this.  Returns
 * true if the callback was invoked directly, otherwise false.  Only
 * the master can call this.
 *
 * Values passed to the callback are as for callWhenUpdated(), above.
 */
SynchronicWorkerUpdates.prototype.callWhenNotEquals = function (v, callback) {
    this._checkAPI(true, "callWhenNotEquals");
    return this._callWhenValueChanges(v, callback, false);
}

// Private

SynchronicWorkerUpdates.prototype._checkAPI = function (requireMaster, m) {
    if (this._isMaster != requireMaster)
	throw new Error("SynchronicWorkerUpdates API abuse: method '" + m + "' not available in " + (this._isMaster ? "master" : "worker"));
}

// This is the same as callWhenUpdated but arguably not very efficient
// for signals that aren't simply 0 or 1.  It may fire off a message
// every time an update happens, if the previous message has been
// handled in the master by the time the next worker update occurs,
// and if the master is waiting for a counter to reach a value it may
// receive a message for every update even if its condition won't be
// met.
//
// To do better we have to store the condition for sending the message
// (equal/not equal, and the trigger value) in the cell and have the
// updating worker check it before sending.  It should still be legal
// to send too many messages - the master must check the condition
// even with that optimization - but it would reduce the number of
// messages in the master.
//
// That optimization conflicts somewhat with allowing multiple master
// "threads" to wait, see comments at _registerCallback() above.

SynchronicWorkerUpdates.prototype._callWhenValueChanges = function (value_, callback, equals) {
    let value = value_|0;
    let ia = this._ia;
    let firstTime = true;

    let check = () => {
	let v = Atomics.load(ia, _SWU_VAL);
	if (equals ? v === value : v !== value) {
	    Atomics.store(ia, _SWU_WAITBITS, 0);
	    callback(firstTime ? SynchronicWorkerUpdates.IMMEDIATE : SynchronicWorkerUpdates.DELAYED);
	    return firstTime;
	}
	firstTime = false;
	Atomics.store(ia, _SWU_WAITBITS, _SWU_WAITFLAG);
	return SynchronicWorkerUpdates._registerCallback(this, check, limit - now);
    }

    return check();
}

SynchronicWorkerUpdates.prototype._notify = function () {
    let ia = this._ia;
    let r = 0;
    if ((r = Atomics.compareExchange(ia, _SWU_WAITBITS,
				_SWU_WAITFLAG,
				     _SWU_WAITFLAG|_SWU_TRANSITFLAG)) == _SWU_WAITFLAG)
    {
	let id = Atomics.load(ia, _SWU_ID);
	postMessage([_SWU_NOTIFYMSG, id]);
    }
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Simple asymmetric shared cells ("synchronic").
// 2016-01-11 / lhansen@mozilla.com

// There are two asymmetric-synchronic types, SynchronicMasterUpdates
// and SynchronicWorkerUpdates (SMU and SWU for short).  In a SMU the
// master updates the cell and the the workers listens for updates; in
// a SWU the workers update the cell and the master listens for
// updates.  This split has been made for the sake of simplicity, in the
// expectation that it serves realistic use cases well enough.
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


// SynchronicMasterUpdates.

const _SMU_SIZE = 12;
const _SMU_ALIGN = 4;

const _SMU_VAL = 0;
const _SMU_NUMWAIT = 1;
const _SMU_SEQ = 2;

// Create a SynchronicMasterUpdates.
//
// Use the same constructor in both master and workers.  Both sides
// must pass the same sab and offset arguments.
//
// "sab" is a SharedArrayBuffer.
// "offset" is an offset within "sab" on a boundary according
// to SynchronicMasterUpdates.BYTE_ALIGN.
// "isMaster" must be true when the master constructs the object
// "init" is the optional initial value for the cell
//
// The cell will own SynchronicMasterUpdates.BYTE_SIZE bytes within
// "sab" starting at "offset".

function SynchronicMasterUpdates(sab, offset, isMaster, init) {
    let ia = new Int32Array(sab, offset, _SMU_SIZE/4);
    if (isMaster) {
	Atomics.store(ia, _SMU_VAL, init);
	Atomics.store(ia, _SMU_NUMWAIT, 0);
	Atomics.store(ia, _SMU_SEQ, 0);
    }
    this._isMaster = isMaster;
    this._ia = ia;
}

SynchronicMasterUpdates.BYTE_SIZE = _SMU_SIZE;
SynchronicMasterUpdates.BYTE_ALIGN = _SMU_ALIGN;

// Reading function - both master and worker can call this

SynchronicMasterUpdates.prototype.load = function () {
    return Atomics.load(this._ia, _SMU_VAL);
}

// Updating functions - only the master can call these

SynchronicMasterUpdates.prototype.store = function (v) {
    this._checkAPI(true, "store");
    let val = v|0;
    Atomics.store(this._ia, _SMU_VAL, val);
    this._notify();
    return val;
}

SynchronicMasterUpdates.prototype.compareExchange = function (oldv, newv) {
    this._checkAPI(true, "compareExchange");
    let oldval = oldv|0;
    let newval = newv|0;
    let result = Atomics.compareExchange(this._ia, _SMU_VAL, oldval, newval);
    if (result == oldval)
	this._notify();
    return result;
}

SynchronicMasterUpdates.prototype.add = function (v) {
    this._checkAPI(true, "add");
    let val = v|0;
    let result = Atomics.add(this._ia, _SMU_VAL, val);
    this._notify();
    return result;
}

SynchronicMasterUpdates.prototype.notify = function () {
    this._checkAPI(true, "notify");
    this._notify();
}

// Listening functions - only the workers can call these

SynchronicMasterUpdates.prototype.expectUpdate = function (v, t) {
    this._checkAPI(false, "expectUpdate");
    let value = v|0;
    let timeout = +t
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

SynchronicMasterUpdates.prototype.waitUntilEquals = function (v) {
    this._checkAPI(false, "waitUntilEquals");
    return this._waitOnValue(v, true);
}

SynchronicMasterUpdates.prototype.waitUntilNotEquals = function (v) {
    this._checkAPI(false, "waitUntilEquals");
    return this._waitOnValue(v, false);
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
	if (equals) {
	    if (v === value)
		return v;
	}
	else {
	    if (v !== value)
		return v;
	}
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


// SynchronicWorkerUpdates.
//
// Usage notes:
//
// The event handling loop in the Master *must*, on receiving a
// Message event, invoke SynchronicWorkerUpdates.filterEvent on that
// event, and if that function returns true the master must not
// process the event itself.
//
// [TODO: anything to be done with event cancellation?]

const _SWU_SIZE = 12;
const _SWU_ALIGN = 4;

const _SWU_VAL = 0;
const _SWU_WAITBITS = 1;
const _SWU_ID = 2;

const _SWU_WAITFLAG = 1;
const _SWU_TRANSITFLAG = 2;

const _SWU_NOTIFYMSG = "SynchronicWorkerUpdate*notify";

// Create a SynchronicWorkerUpdates.
//
// Use the same constructor in both master and workers.  Both sides
// must pass the same sab and offset arguments.
//
// "sab" is a SharedArrayBuffer.
// "offset" is an offset within "sab" on a boundary according
// to SynchronicMasterUpdates.BYTE_ALIGN.
// "isMaster" must be true when the master constructs the object
// "init" is the optional initial value for the cell
//
// The cell will own SynchronicMasterUpdates.BYTE_SIZE bytes within
// "sab" starting at "offset".

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

SynchronicWorkerUpdates.BYTE_SIZE = _SWU_SIZE;
SynchronicWorkerUpdates.BYTE_ALIGN = _SWU_ALIGN;

SynchronicWorkerUpdates.TIMEDOUT = 1;
SynchronicWorkerUpdates.IMMEDIATE = 2;
SynchronicWorkerUpdates.DELAYED = 3;

SynchronicWorkerUpdates.filterEvent = function (ev) {
    if (Array.isArray(ev.data) && ev.data.length >= 2 && ev.data[0] == _SWU_NOTIFYMSG) {
	this._dispatchCallback(ev.data[1]);
	return true;
    }
    return false;
}

// Private properties

SynchronicWorkerUpdates._callbacks = {};
SynchronicWorkerUpdates._idents = 1;

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

// Reading functions - both sides

SynchronicWorkerUpdates.prototype.load = function () {
    return Atomics.load(this._ia, _SWU_VAL);
}

// Updating functions - workers only

SynchronicWorkerUpdates.prototype.store = function (v) {
    this._checkAP(false, "store");
    let val = v|0;
    Atomics.store(this._ia, _SWU_VAL, val);
    this._notify();
    return val;
}

SynchronicWorkerUpdates.prototype.compareExchange = function (oldv, newv) {
    this._checkAPI(false, "compareExchange");
    let oldval = oldv|0;
    let newval = newv|0;
    let result = Atomics.compareExchange(this._ia, _SWU_VAL, oldval, newval);
    if (result == oldval)
	this._notify();
    return result;
}

SynchronicWorkerUpdates.prototype.add = function (v) {
    this._checkAPI(false, "add");
    let val = v|0;
    let result = Atomics.add(this._ia, _SWU_VAL, val);
    this._notify();
    return result;
}

SynchronicWorkerUpdates.prototype.notify = function () {
    this._checkAPI(false, "notify");
    this._notify();
}

// Listening functions - master only

// callWhenUpdated invokes callback when the cell's value has been
// observed to no longer be v, waiting at most t.  When the callback
// is invoked it is invoked with one of three values: SWU.TIMEDOUT if
// there was a timeout, SWU.DELAYED if the callback was not performed
// immediately, and SWU.IMMEDIATE if the callback was performed
// immediately.
//
// callWhenUpdated returns true if the callback was performed
// immediately, otherwise false.

SynchronicWorkerUpdates.prototype.callWhenUpdated = function (v, callback, t) {
    this._checkAPI(true, "callWhenUpdated");

    let value = v|0;
    let timeout = +t;
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

// These have the same semantics as above, apart from timeout.

SynchronicMasterUpdates.prototype.callWhenEquals = function (v, callback) {
    this._checkAPI(true, "waitUntilEquals");
    return this._callWhenValueChanges(v, callback, true);
}

SynchronicMasterUpdates.prototype.callWhenNotEquals = function (v, callback) {
    this._checkAPI(true, "waitUntilEquals");
    return this._callWhenValueChanges(v, callback, false);
}


// Private

SynchronicWorkerUpdates.prototype._checkAPI = function (requireMaster, m) {
    if (this._isMaster != requireMaster)
	throw new Error("SynchronicWorkerUpdates API abuse: method '" + m + "' not available in " + (this._isMaster ? "master" : "worker"));
}

// This is the same as callWhenUpdated but arguably not very efficient
// for signals that aren't simply 0 or 1.  It may fire off a message
// every time an update happens, if the previous message is handled by
// the time the next update occurs, and if the listener is waiting for
// a counter to reach a value it may still receive a message for every
// update even if its condition won't be met.
//
// To do better we have to store the condition for sending the message
// (equal/not equal, and the trigger value) in the cell and have the
// updating worker check it before sending.  It should still be legal
// to send too many messages - the master must check the condition
// even with that optimization - but it would reduce the number of
// messages in the master.

SynchronicWorkerUpdates.prototype._callWhenValueChanges = function (v, callback, equals) {
    let value = v|0;
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

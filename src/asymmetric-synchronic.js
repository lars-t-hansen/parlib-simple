// There are two asymmetric-synchronic types, SynchronicMasterUpdates
// and SynchronicWorkerUpdates (SMU and SWU for short).  In a SMU the
// master updates the cell and the the workers listens for updates; in
// a SWU the workers update the cell and the master listens for
// updates.
//
// In both cases, both sides can read the current value of the cell
// but the updating functions are reserved for one side and the
// listening functions are reserved for the other side.
//
// This is a simplified API (proof of concept) - Int32 only, and with
// a limited method suite.

// Utilities

const _now =
      (typeof "performance" != "undefined" && typeof performance.now == "function"
       ? performance.now.bind(performance)
       : Date.now.bind(Date));

const _setTimeout =
      (typeof "setTimeout" == "function"
       ? setTimeout
       : function (cb, timeout) {
	   throw new Error("No timeouts available");
       });


// SynchronicMasterUpdates.
//
// This is pretty much just a regular synchronic cell, since the
// master won't attempt to block with futexWait.

const _SMU_SIZE = 12;
const _SMU_ALIGN = 4;

const _SMU_VAL = 0;
const _SMU_NUMWAIT = 1;
const _SMU_SEQ = 2;

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

// Reading functions - both sides

SynchronicMasterUpdates.prototype.load = function () {
    return Atomics.load(this._ia, _SMU_VAL);
}

// Updating functions - master only

SynchronicMasterUpdates.prototype.store = function (v) {
    if (!this._isMaster)
	this._badAPI();
    let val = v|0;
    Atomics.store(this._ia, _SMU_VAL, val);
    this._notify();
    return val;
}

SynchronicMasterUpdates.prototype.compareExchange = function (oldv, newv) {
    if (!this._isMaster)
	this._badAPI();
    let oldval = oldv|0;
    let newval = newv|0;
    let result = Atomics.compareExchange(this._ia, _SMU_VAL, oldval, newval);
    if (result == oldval)
	this._notify();
    return result;
}

SynchronicMasterUpdates.prototype.add = function (v) {
    if (!this._isMaster)
	this._badAPI();
    let val = v|0;
    let result = Atomics.add(this._ia, _SMU_VAL, val);
    this._notify();
    return result;
}

SynchronicMasterUpdates.prototype.notify = function () {
    if (!this._isMaster)
	this._badAPI();
    this._notify();
}

// Listening functions - workers only

SynchronicMasterUpdates.prototype.expectUpdate = function (v, t) {
    if (this._isMaster)
	this._badAPI();
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

// Private

SynchronicMasterUpdates.prototype._badAPI = function () {
    throw new Error("Bad API: method not available in " + (this._isMaster ? "master" : "worker"));
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
// This is substantially different from a regular synchronic cell,
// since the master can't block with futexWait.
//
// The event handling loop in the Master *must*, on receiving a
// Message event, invoke SynchronicWorkerUpdates.filterEvent, and if
// that returns true it must not process the event itself.
//
// [TODO: anything to be done with event cancellation?]
//
// Both sides can read the current value but the updating functions
// are reserved for the workers and the listening functions are
// reserved for the master.

const _SWU_SIZE = 12;
const _SWU_ALIGN = 4;

const _SWU_VAL = 0;
const _SWU_WAITBITS = 1;
const _SWU_ID = 2;

const _SWU_WAITFLAG = 1;
const _SWU_TRANSITFLAG = 2;

const _SWU_NOTIFYMSG = "SynchronicWorkerUpdate*notify";

// id is a globally unique SWU identifier (positive int32), supply this in the master only.
// init is an initial value, defaults to zero, supply this in the master only.

function SynchronicWorkerUpdates(sab, offset, isMaster, id, init) {
    let ia = new Int32Array(sab, offset, _SWU_SIZE/4);
    if (isMaster) {
	Atomics.store(ia, _SWU_VAL, init);
	Atomics.store(ia, _SWU_WAITBITS, 0);
	Atomics.store(ia, _SWU_ID, id);
	if (SynchronicWorkerUpdates._callbacks.hasOwnProperty(id))
	    throw new Error("ID is already in use: " + id);
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
    if (Array.isArray(ev.data) && ev.data.length >= 2 && ev.data[0] == _SWU_NOTIFYMSG)
	this._dispatchCallback(ev.data[1]);
	return true;
    }
    return false;
}

SynchronicWorkerUpdates._callbacks = {};

SynchronicWorkerUpdates._registerCallback = function(swu, cb, timeout) {
    let id = swu._id;
    if (this._callbacks[id])
	throw new Error("Callback already live on a SynchronicWorkerUpdates");
    this._callbacks[id] = cb;
    if (timeout != Number.POSITIVE_INFINITY)
	_setTimeout(() => this._dispatchCallback(id), timeout);
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
    if (this._isMaster)
	this._badAPI();
    let val = v|0;
    Atomics.store(this._ia, _SWU_VAL, val);
    this._notify();
    return val;
}

SynchronicWorkerUpdates.prototype.compareExchange = function (oldv, newv) {
    if (this._isMaster)
	this._badAPI();
    let oldval = oldv|0;
    let newval = newv|0;
    let result = Atomics.compareExchange(this._ia, _SWU_VAL, oldval, newval);
    if (result == oldval)
	this._notify();
    return result;
}

SynchronicWorkerUpdates.prototype.add = function (v) {
    if (this._isMaster)
	this._badAPI();
    let val = v|0;
    let result = Atomics.add(this._ia, _SWU_VAL, val);
    this._notify();
    return result;
}

SynchronicWorkerUpdates.prototype.notify = function () {
    if (this._isMaster)
	this._badAPI();
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
    if (!this._isMaster)
	this._badAPI();

    let value = v|0;
    let timeout = +t
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

    return check;
}

// Private

SynchronicWorkerUpdates.prototype._badAPI = function () {
    throw new Error("Bad API: method not available in " + (this._isMaster ? "master" : "worker"));
}

SynchronicWorkerUpdates.prototype._notify = function () {
    let ia = this._ia;
    if (Atomics.compareExchange(ia, _SWU_WAITBITS,
				_SWU_WAITFLAG,
				_SWU_WAITFLAG|_SWU_TRANSITFLAG) == _SWU_WAITFLAG)
    {
	postMessage([_SWU_NOTIFYMSG, Atomics.load(ia, _SWU_ID)]);
    }
}

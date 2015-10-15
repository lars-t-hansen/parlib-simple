// A "synchronic" cell that can be used to communicate between a
// master (main thread) and workers, where the master is not allowed
// to block.
//
// Only int32 values are supported at the moment (MUSTFIX, a la synchronic)
// MasterSynchronic.NUM_CELLS states the number of consecutive cells
// that are needed (MUSTFIX, follow synchronic instead)
//
// Workers can use this as a regular synchronic cell, and if the
// master is one of those waiting it will be woken.

// For this to work properly, we need a flag that the master is waiting,
// perhaps this is a negative wait count or perhaps better a bit or two.
//
// Need to worry about in-flight messages for the master, too, so that
// there's not a flood of wakeups being sent.  Look to asymmetric-futex
// for ideas.  Can that be used directly?

function MasterSynchronic(i32a, loc, id) {
    this._ia = i32a;
    this._loc = loc;
    this._id = id;
}

const _SYN_SYNSIZE = 16;
const _SYN_SYNALIGN = 8;

const _SYN_NUMWAIT = 0;
const _SYN_WAITGEN = 1;

MasterSynchronic.NUM_CELLS = _SYN_SYNSIZE >> 2;

MasterSynchronic.prototype.load = function () {
    return Atomics.load(this._ia, this._loc);
}

MasterSynchronic.prototype.store = function (v) {
    var result = Atomics.store(this._ia, this._loc, v);
    this._notify();
    return result;
}

MasterSynchronic.prototype.add = function (v) {
    var result = Atomics.add(this._ia, this._loc, v);
    this._notify();
    return result;
}

MasterSynchronic.prototype.compareExchange = function (expect, replace) {
    var result = Atomics.compareExchange(this._ia, this._loc, expect, replace);
    this._notify();
    return result;
}

MasterSynchronic.prototype.expectUpdate = function (value_, timeout_) {
    var value = this._coerce(value_);
    var timeout = +timeout_;
    var now = this._now();
    var limit = now + timeout;
    for (;;) {
	var tag = Atomics.load(this._ia, this._iaIdx+_SYN_WAITGEN);
	var v = Atomics.load(this._ta, this._taIdx) ;
	if (v !== value || now >= limit)
	    break;
	this._waitForUpdate(tag, limit - now);
	now = this._now();
    }
}

MasterSynchronic.prototype._notify = function () {
    Atomics.add(this._ia, this._loc+_SYN_WAITGEN, 1);
    // Would it be appropriate & better to wake n waiters, where n
    // is the number loaded in the load()?  I almost think so,
    // since our futexes are fair.
    if (Atomics.load(this._ia, this._iaIdx+_SYN_NUMWAIT) > 0) {
	// This wakes only other workers, since we're in the master
	Atomics.futexWake(this._ia, this._iaIdx+_SYN_WAITGEN, Number.POSITIVE_INFINITY);
    }
}

function WorkerSynchronic(i32a, loc, id) {
}

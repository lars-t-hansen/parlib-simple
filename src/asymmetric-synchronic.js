/*

The API for this would be as for synchronic, except that on the main
thread, loadWhenNotEqual, loadWhenEqual, and expectUpdate would not be
called, instead one would call eg callWhenNotEqual(val,cb),
callWhenEqual(val,cb), and callWhenUpdated(val,timeout,cb).

The callback is only invoked if the observed state change has taken
place, the looping that now happens synchronously in the the
implementation happens in a wrapper for the callback.

callWhenEqual would return a boolean, true means "done" and false
means "wait".  The client code would have to load the observed value
itself.  (Ditto the others.)

*/


// A prototype "synchronic" cell that can be used to communicate
// between a master (main thread) and workers, where the master is not
// allowed to block.
//
// For simplicity: Only int32 values are supported at the moment.
// MasterSynchronic.NUM_CELLS states the number of consecutive cells
// that are needed.
//
// Workers can use this as a regular synchronic cell.  A notification
// from anywhere will reach anyone who's waiting.  This means that if
// eight "threads" in the main thread are waiting (asynchronously)
// then they will all be notified when a change happens, and if five
// workers are waiting they will be notified too.

// Suppose there is one global queue of waiters per synchronic.  Really
// this can be implemented as a two-field counter, the number of worker
// waiters and the number of master waiters, so long as the wakeup mechanism
// preserves some fairness property.  We don't need an actual data
// structure.
//
// When notifying waiters on the synchronic, consult some oracle about
// how to bias the wakeup (workers before masters or vice versa), and
// then wake as many as possible from each set, skewing in the
// direction of the bias when an odd count is required.  With luck,
// the bias can be a low(ish) bit of some sequence number.
//
// This is much easier to implement with synchronic than futex,
// because synchronic has private state that can be controlled with a
// lock.

/*

Suppose there are several counters:

- last update made to cell
- last wakeup sent to main thread
- last update processed by main thread

The wakeup carries a counter, too.

*/

// Need to worry about in-flight messages for the master, too, so that
// there's not a flood of wakeups being sent.  Look to asymmetric-futex
// for ideas.  Can that be used directly?  [No, it is too limited, it
// is strictly a master <-> worker mechanism.]


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

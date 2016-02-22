/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* A polyfill for the synchronic proposal, using futexes and
 * spinloops.  This should perform reasonably well across platforms
 * but is probably suboptimal on all platforms.
 *
 * Users should call polyfillSynchronic(), below, with the required
 * parameters.  That function will polyfill unconditionally, so watch it.
 *
 * Tested with Chrome 50 Canary, Firefox 47 Nightly, and Firefox 46
 * Developer Edition on 2016-02-22.
 */

var Synchronic = {

    // Number of shared bookkeeping locations, see setup().

    NUMLOCS: 1,

    // Every worker must call this first.  It is called from
    // polyfillSynchronic, if you use that.  "locs" is an Int32Array
    // on shared memory that the Synchronic system can use for
    // bookkeeping.  The length is at least Synchronic.NUMLOCS, slots
    // 0 through NUMLOCS will be clobbered by Synchronic.  All the loc
    // values must be zero before any worker calls setup().

    setup: function (locs) {
	Synchronic._private = locs;
    },

    // Wait until i32a[loc] == desired.

    expect: function (i32a, loc, desired) {
	for ( var i=Synchronic._spincount ; i >= 0 ; i-- )
	    if (Atomics.load(i32a, loc) == desired)
		return;
	var m = 0;
	Atomics.add(Synchronic._private, 0, 1);
	while ((m = Atomics.load(i32a, loc)) != desired)
            Atomics.futexWait(i32a, loc, m);
	Atomics.sub(Synchronic._private, 0, 1);
    },

    // Wait until i32a[loc] != current or we time out.

    expectUpdate: function (i32a, loc, current, timeout) {
	// Bug: the timeout, if present, should be accounted for in
	// the spin loop, and should be subtracted from the timeout
	// passed to futexWait.
	for ( var i=Synchronic._spincount ; i >= 0 ; i-- )
	    if (Atomics.load(i32a, loc) != current)
		return;
	Atomics.add(Synchronic._private, 0, 1);
	for (;;) {
	    if (Atomics.futexWait(i32a, loc, current, timeout) != Atomics.OK)
		break;
	    if (Atomics.load(i32a, loc) != current)
		break;
	}
	Atomics.sub(Synchronic._private, 0, 1);
    },

    // Store v in i32a[loc] and notify waiters to re-check conditions.
    //
    // This can in principle be optimized by only notifying those
    // waiters that might respond to the value "v", eg, anyone
    // expecing a different value "w" need not be woken.

    storeNotify: function (i32a, loc, v, justOne) {
	Atomics.store(i32a, loc, v);
	if (Atomics.load(Synchronic._private, 0)) {
	    // INT_MAX becuse Chrome Canary 50 crashes on Number.POSITIVE_INFINITY
	    Atomics.futexWake(i32a, loc, justOne ? 1 : 0x7FFFFFFF);
	}
    },

    // Notify waiters to re-check conditions.

    notify: function (i32a, loc, justOne) {
	if (Atomics.load(Synchronic._private, 0)) {
	    // INT_MAX because Chrome Canary 50 crashes on Number.POSITIVE_INFINITY
	    Atomics.futexWake(i32a, loc, justOne ? 1 : 0x7FFFFFFF);
	}
    },

    // ------------------------------------------------------------

    _private: null,

    // Value based on minimal experimentation on one (fast) platform:
    // This is long enough to allow the "work" between a receive and a
    // send in the synchronic benchmark to be doubly-recursive fib(10)
    // in Firefox Nightly without going into futexWait most of the
    // time.  (The cutoff for Chrome Canary is below 50 [sic].)

    _spincount: 5000,
}

function mustPolyfillSynchronic() {
    return !Atomics.expect;
}

// locs is an array of shared int32 values, see setup() above.

function polyfillSynchronic(locs) {
    if (!mustPolyfillSynchronic())
	return;
    if (!(locs instanceof Int32Array) || !(locs.buffer instanceof SharedArrayBuffer) || locs.length < Synchronic.NUMLOCS)
	throw new Error("Bad bookkeeping data structure for polyfillSynchronic()");
    Atomics.expect = Synchronic.expect;
    Atomics.expectUpdate = Synchronic.expectUpdate;
    Atomics.storeNotify = Synchronic.storeNotify;
    Atomics.notify = Synchronic.notify;
    Synchronic.setup(locs);
}

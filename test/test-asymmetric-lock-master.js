/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Test the asymmetric lock.
//
// Maintain shared data as follows:
//   - a float64 counter, initially zero
//   - an integer flag, initially zero
//   - an asymmetric lock
//
// Each worker, and the main thread, all perform some mildly expensive
// and somewhat random-time computation and enter the critical section
// (by acquiring the lock) when the computation is done.  At that
// point they check that the integer flag word is zero and flip their
// own bit.  Then they update the counter and do some stuff so that
// they stay in the critical section for a while.  Then they unflip
// the bit, check that the flag word is still zero, and exit the
// critical section.
//
// Repeat for a large number of iterations.  No worker should observe
// a nonzero flag, and at the end we should be able to predict the
// counter value.

const numWorkers = 3;
const numIter = 3;

const sab = new SharedArrayBuffer(4*(1 + MasterLock.NUMINTS) + 8*1);
const fab = new SharedFloat64Buffer(sab, 0, 1);
const iab = new SharedInt32Array(sab, 8, 1+MasterLock.NUMINTS);
const flagIdx = 0;		// in iab
const lockIdx = 1;		// in iab
const lock = new MasterLock(iab, lockIdx);

function runTest() {
    var readies = 0;
    for ( var id=0 ; id < numWorkers ; id++ ) {
        var w = new Worker("test-asymmetric-lock-worker.js");
        w.onmessage =
            function (ev) {
		if (Array.isArray(ev.data) && ev.data[0] === "MasterLock.dispatch")
		    MasterLock.dispatch(ev.data);
		else {
                    console.log(ev.data);
		    if (typeof ev.data == 'string' && ev.data.startsWith("ready")) {
			readies++;
			if (readies == numWorkers)
			    setTimeout(masterComputer, 0);
		    }
		}
            };
        w.postMessage([sab, numIter, fab.byteOffset, iab.byteOffset, iab.length, id], [sab]);
    }
}

var iter = 0;
var sync = 0;
var async = 0;

function masterComputer() {
    while (iter < numIter) {
	var result = compute();	// In included file
	++iter;
	if (lock.trySyncLock()) {
	    ++sync;
	    criticalSection(result);
	    lock.syncUnlock();
	}
	else {
	    ++async;
	    lock.asyncLock(function () {
		criticalSection(result);
		return masterComputer;
	    });
	    return;
	}
    }
    // Check the result, if possible: we may have to wait for all the
    // workers to terminate.
    //
    // Check that both sync and async are nonzero.
}

function criticalSection(result) {
    if (Atomics.or(iab, flagIdx, (1 << numWorkers)) != 0)
	throw new Error("Flag found to be nonzero");
    fab[0] += mangleResult(result);
    if (Atomics.and(iab, flagIdx, ~(1 << numWorkers)) != (1 << numWorkers))
	throw new Error("Flag found to be nonzero");
}

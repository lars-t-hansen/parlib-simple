/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Test the float64atomics polyfill.
//
// Fork off several workers that each add a large number of 1's to a
// counter, atomically, and check the result.
//
// It is easy to see that the locking is effective: try commenting out
// the spinlock loop at the beginning of float64Add, for example, and
// run the test that way, it will fail.

// TODO: right now this just has one phase that tests float64Add, need
// to test all the other operations too.

var numWorkers = 5;
var nbytes = (8 + 4*(MasterBarrier.NUMINTS + Atomics.NUMF64INTS) + 7) & ~7;
var sab = new SharedArrayBuffer(nbytes);
var dab = new Float64Array(sab);
var accIdx = 0;
var iab = new Int32Array(sab);
var barrierIdx = 2;
var atomicIdx = barrierIdx + MasterBarrier.NUMINTS;
var barrierId = 1337;
var barrier = new MasterBarrier(iab, barrierIdx, barrierId, numWorkers, workersQuiescent);
var state = 0;
var iterations = 1000000;

function runTest() {
    for ( var i=0 ; i < numWorkers ; i++ ) {
	var w = new Worker("test-float64atomics-worker.js");
	MasterBarrier.addWorker(w);
	w.addEventListener("message", function (ev) { msg(String(ev.data)) });
	w.postMessage([sab, barrierIdx, barrierId, accIdx, atomicIdx, iterations]);
    }
}

var startTime;

function workersQuiescent() {
    if (state++ == 0) {
	startTime = Date.now();
	barrier.release();
	return;
    }
    var endTime = Date.now();
    var expect = numWorkers*iterations;
    if (dab[accIdx] != expect)
	msg(`Error: got ${dab[accIdx]}, expected ${expect}`);
    msg(`Done in ${endTime - startTime} ms`);
    barrier.release();
}

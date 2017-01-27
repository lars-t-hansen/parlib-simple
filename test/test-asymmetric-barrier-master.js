/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Test the MasterBarrier/WorkerBarrier type.
// 2015-01-20 / lhansen@mozilla.com
//
// Create K workers that, on each iteration, read an addend from
// shared memory and add it to the elements in their segment of a
// shared array, and then enter a barrier.
//
// The addend is multiplied by PI each iteration so a worker that
// just races ahead is unlikely to compute the correct result.

const numWorkers = 3;
const segmentSize = 1000;
const bufSize = segmentSize*numWorkers;
const barrierID = 1337;
const numIter = 3;

var alloc = 0;
var bufIdx = alloc/8;		// Index in dab
    alloc += 8*bufSize;
var addendIdx = alloc/8;	// Index in dab
    alloc += 8;
var barrierIdx = alloc/4;	// Index in iab
    alloc += MasterBarrier.NUMINTS*4;

var iter = 0;
var addend = 1;
var expected = 0;

const sab = new SharedArrayBuffer(alloc);
const iab = new Int32Array(sab);
const dab = new Float64Array(sab);
const barrier = new MasterBarrier(iab, barrierIdx, barrierID, numWorkers, barrierReady);

function runTest() {
    for ( var id=0 ; id < numWorkers ; id++ ) {
        var w = new Worker("test-asymmetric-barrier-worker.js");
	MasterBarrier.addWorker(w);
	w.addEventListener("message", function (ev) { msg(String(ev.data)) });
        w.postMessage(["setup", sab, numIter, barrierIdx, barrierID, addendIdx, segmentSize*id, segmentSize]);
    }
}

function barrierReady() {
    if (iter++ < numIter) {
	if (iter > 1)
	    addend *= Math.PI;
	dab[addendIdx] = addend;
	expected += addend;
	barrier.release();
    }
    else {
	msg("Checking " + numWorkers*segmentSize + " elements");
	for ( var i=0 ; i < numWorkers*segmentSize ; i++ )
            if (dab[i] != expected)
		msg("Failed at element " + i + ": " + dab[i] + " " + expected);
	msg("done: master");
    }
}

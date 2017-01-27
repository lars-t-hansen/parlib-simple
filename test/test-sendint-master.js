/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This is the "simplest possible" message passing benchmark: it has
// one integer location for data and uses one synchronic to ping-pong
// a critical section for that datum between threads.

// On my MacBook Pro this currently gets about 6,250,000 msgs/sec,
// which sure beats anything possible with postMessage.

var iterations = 500000;
var bufSize = 1024;		// Should be divisible by 2 and "large enough"

var w = new Worker("test-sendint-worker.js");
var sab = new SharedArrayBuffer(bufSize);

// Setup our state first.

var s = new SynchronicInt32(sab, 0);
var locIdx = 512;

// Kick off the worker and wait for a message that it is ready.

w.onmessage = workerReady;
w.postMessage([sab, 0, 512, iterations]);

console.log("Master waiting");

function workerReady(ev) {
    var iab = new Int32Array(sab, locIdx, 1);
    var start = Date.now();

    for ( var i=0 ; i < iterations ; i++ ) {
	iab[0]++;
	var old = s.add(1);
	s.expectUpdate(old+1, Number.POSITIVE_INFINITY);
    }

    var end = Date.now();

    console.log("Should be " + iterations*2 + ": " + iab[0]);
    console.log(Math.round(1000 * (2*iterations) / (end - start)) + " messages/s");
}

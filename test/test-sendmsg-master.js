/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Data point:
// - Shared-memory channels are about 5x faster than postMessage
//   channels (210K msg/s vs 41K msg/s) when sending integers.
//
// - Shared-memory channels increase the advantage to 6x when sending
//   objects with an integer field (160K vs 25K).

// At the same time, there are clearly some lost messages along the
// way...  Things hang easily here.  This is not good.  With instrumentation
// I see the master timing out on receive, a good place to start looking.

var iterations = 100000;

var w = new Worker("test-sendmsg-worker.js");
var sab = new SharedArrayBuffer(8192);

// Init code is wrong: the fourth argument is ignored, and the sender always
// initializes.  That should not matter for now, but we should fix.

var s = new ChannelSender(sab, 0, 4096, true);
var r = new ChannelReceiver(sab, 4096, 4096, true);

// Do not kick off the worker until we're done constructing state.
// The worker will send a message back when it too is ready.

w.onmessage = workerReady;
w.postMessage([sab, iterations], [sab]);

console.log("Master waiting");

function workerReady(ev) {
    var c = {item:0};
    var start;
    for ( var i=0 ; i < iterations ; i++ ) {
	s.send(c);
	if (i == 0)
	    start = Date.now();
	c = r.receive();
    }
    console.log("Should be " + iterations + ": " + c.item);
    console.log(Math.round(1000 * (2*iterations) / (Date.now() - start)) + " messages/s");
}

function runTest() {}

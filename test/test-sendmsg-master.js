/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Data points (Nightly, May 2015):
//
// - Shared-memory channels are about 5x faster than postMessage
//   channels (210K msg/s vs 41K msg/s) when sending just one integer
//   back and forth.
//
// - Shared-memory channels increase the advantage to 6x when sending
//   objects with an integer field (160K vs 25K).

var iterations = 100000;
var bufSize = 8192;		// Should be divisible by 2 and "large enough"
                                //  (8K is much more than needed for this test)

var w = new Worker("test-sendmsg-worker.js");
var sab = new SharedArrayBuffer(bufSize);

// Setup our state first.

var s = new ChannelSender(sab, 0, bufSize/2);
var r = new ChannelReceiver(sab, bufSize/2, bufSize/2);

// Kick off the worker and wait for a message that it is ready.

w.onmessage = workerReady;
w.postMessage([sab, iterations, 0, bufSize/2, bufSize/2, bufSize/2]);

console.log("Master waiting");

function workerReady(ev) {
    var start = Date.now();

    var c = {item:0};
    for ( var i=0 ; i < iterations ; i++ ) {
	s.send(c);
	c = r.receive();
    }

    var end = Date.now();

    console.log("Should be " + iterations + ": " + c.item);
    console.log(Math.round(1000 * (2*iterations) / (end - start)) + " messages/s");
}

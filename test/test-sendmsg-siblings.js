/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Create two sibling workers, who share some memory that they use for
// communication.

// This has the same performance as the master-to-worker case: about
// 165000 msgs/sec (objects with a single field) on my late-2013
// MacBook Pro.

var iterations = 100000;

var w1 = new Worker("test-sendmsg-sibling1.js");
var w2 = new Worker("test-sendmsg-sibling2.js");
var sab = new SharedArrayBuffer(8192);

w1.onmessage = workerReady;
w2.onmessage = workerReady;

w1.postMessage(["setup", 1, sab, iterations]);
w2.postMessage(["setup", 2, sab, iterations]);

var waiting = 2;

function workerReady(ev) {
    --waiting;
    if (waiting > 0)
	return;

    w1.postMessage(["go"]);
    w2.postMessage(["go"]);
}

function runTest() {}

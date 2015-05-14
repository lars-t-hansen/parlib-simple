/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var iterations = 100000;

var w = new Worker("test-postmsg-worker.js");

w.onmessage = workerReady;
w.postMessage([iterations]);

function workerReady(ev) {
    w.onmessage = processMsg;
    document.getElementById("button").disabled = false;
}

var i;
var start;

function runTest() {
    document.getElementById("button").disabled = true;
    msg("Master waiting");
    i = 0;
    start = Date.now();
    w.postMessage({item:0});
}

function processMsg(ev) {
    var c = ev.data;
    if (++i == iterations) {
	msg("Should be " + iterations + ": " + c.item);
	msg(Math.round(1000 * (2*iterations) / (Date.now() - start)) + " messages/s");
	document.getElementById("button").disabled = false;
	return;
    }
    w.postMessage(c);
}

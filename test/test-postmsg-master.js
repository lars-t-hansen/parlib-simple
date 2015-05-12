/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var iterations = 100000;

var w = new Worker("test-postmsg-worker.js");

w.onmessage = workerReady;
w.postMessage([iterations]);

console.log("Master waiting");

function workerReady(ev) {
    console.log(ev.data);
    var i = 0;
    var start = Date.now();
    w.onmessage = function (ev) {
	var c = ev.data;
	if (++i == iterations) {
	    console.log("Should be " + iterations + ": " + c);
	    console.log(Math.round(1000 * (2*iterations) / (Date.now() - start)) + " messages/s");
	    return;
	}
	w.postMessage(c);
    };
    w.postMessage({item:0});
}

function runTest() {}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Test the MasterFutex/WorkerFutex type.
// 2015-10-02 / lhansen@mozilla.com

// TODO: multiple locations
// TODO: multiple arrays
// TODO: also see the -worker code

var sab = new SharedArrayBuffer(100);
var iab = new Int32Array(sab);
var id = 0;
var mf = new MasterFutex(iab, id);
var testloc = 10;			// iab[10] and iab[11] are reserved for a futex loc

var w = new Worker("test-asymmetric-futex-worker.js");

w.onmessage = function (ev) {
    if (MasterFutex.dispatch(ev))
	return;
    console.log(ev.data);
}
w.postMessage(["start", sab, id, testloc]);

var then = new Date();

// Each waiting callback represents a separate thread of control in the master, really.
// Waiters will be woken in order; meanwhile, the timeout will fire because that represents
// another thread of control.
//
// Notice these are all waiting on the same location, and some simultaneously.

mf.wait(testloc, 0, function (result) {
    console.log("Awoken 1 with result " + result + " (should be 0) after " + (new Date() - then) + " (should be just over 1000)");

    // Awoken 2 and 3 will come a second after Awoken 1, so the timeout should come in between them
    setTimeout(function () {
	console.log("Should fire before awoken 2");
    }, 500);

    // This will be woken after the two below because it ends up behind them in the queue
    mf.wait(testloc, 0, function (result) {
	console.log("Awoken 4 with result " + result + " (should be 0) after " + (new Date() - then) + " (should be just over 3000)");
    });
});

// These two are woken together
mf.wait(testloc, 0, function (result) {
    console.log("Awoken 2 with result " + result + " (should be 0) after " + (new Date() - then) + " (should be just over 2000)");
});
mf.wait(testloc, 0, function (result) {
    console.log("Awoken 3 with result " + result + " (should be 0) after " + (new Date() - then) + " (should be just over 2000)");
});

// Awoken 1 should come after a second so this should fire first.
setTimeout(function () {
    console.log("Should fire before awoken 1");
}, 500);

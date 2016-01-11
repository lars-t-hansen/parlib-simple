/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

importScripts("../src/asymmetric-synchronic.js");

var DEBUG = true;

onmessage = function (ev) {
    let [ _, myId, sab, smuOffset, swuOffset ] = ev.data;
    let SMU = new SynchronicMasterUpdates(sab, smuOffset, false);
    let SWU = new SynchronicWorkerUpdates(sab, swuOffset, false);
    let v = 0;
    let results = [];
    let iter = 0;
    for (;;) {
	SMU.expectUpdate(v);
	v = SMU.load();
	++iter;
	if (DEBUG)
	    console.log("Worker " + myId + " saw " + v + (myId == v ? "" : " but wanted " + myId + "; retrying " + iter));
	if (v != myId) {
	    if (iter > 100) {
		console.log("Too many retries; bailing out");
		break;
	    }
	    continue;
	}
	iter = 0;
	results.push(fib(25+v));
	if (DEBUG)
	    console.log("Storing myId: " + myId);
	SWU.store(myId);
    }
}

function fib(n) {
    if (n < 2)
	return n;
    return fib(n-1) + fib(n-2);
}


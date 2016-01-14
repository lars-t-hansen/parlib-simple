/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

importScripts("../src/asymmetric-synchronic.js");

var DEBUG = false;

onmessage = function (ev) {
    let [ _, myId, sab, asOffset] = ev.data;
    let AS = new AsymmetricSynchronic(sab, asOffset, false);
    let v = 0;
    let results = [];
    let iter = 0;
    for (;;) {
	AS.waitUntilEquals(myId);
	v = AS.load();
	if (v != myId) {
	    ++iter;
	    console.log("Worker " + myId + " saw " + v + " but wanted " + myId + "; retrying " + iter);
	    if (iter > 100) {
		console.log("Too many retries; bailing out");
		break;
	    }
	    continue;
	}
	iter = 0;
	results.push(fib(25+v));
	if (DEBUG)
	    console.log("Storing -myId: " + -myId);
	AS.store(-myId);
    }
}

function fib(n) {
    if (n < 2)
	return n;
    return fib(n-1) + fib(n-2);
}


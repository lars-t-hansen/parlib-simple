/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

importScripts("../src/asymmetric-synchronic.js",
	      "../src/asymmetric-intqueue.js");

onmessage = function (ev) {
    let d = ev.data;
    let myId = d[1];
    let sab = d[2];
    let offset = d[3];
    let alloc = d[4];
    let iterations = d[5];
    let MPIQ = new MasterProducerIntQueue(sab, offset, alloc, false);

    let received = [];
    for (;;) {
	let item = MPIQ.take();
	if (item[1] === 0)
	    break;
	if (item.length != item[1] + 4) {
	    console.log("Bad item: " + item);
	    break;
	}
	let iter = item[0];
	let n = item[1];
	let fibn = item[2];
	let fibn3 = item[3];
	if (fibn3 != fib(n-3)) {
	    console.log("Bad data: " + item);
	    break;
	}
	received.push(iter);
    }
    postMessage(["phase1", myId, received]);
}

function fib(n) {
    if (n < 2)
	return n;
    return fib(n-1) + fib(n-2);
}

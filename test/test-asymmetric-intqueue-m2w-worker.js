/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

importScripts("../util/shim.js",
	      "../src/asymmetric-synchronic.js",
	      "../src/asymmetric-intqueue.js");

onmessage = function (ev) {
    let [_, myId, sab, offset, alloc, iterations] = ev.data;
    let MPIQ = new MasterProducerIntQueue(sab, offset, alloc, false);

    let received = [];
    for (;;) {
	let item = MPIQ.take();
	//console.log("Item was received: " + item);
	if (item[1] === 0)
	    break;
	if (item.length != item[1] + 4) {
	    console.log("Bad item: " + item);
	    break;
	}
	let [iter, n, fibn, fibn3] = item;
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

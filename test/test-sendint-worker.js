/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

importScripts("../util/shim.js", "../src/synchronic.js");

onmessage =
    function (ev) {
	var [sab, sabIdx, locIdx, iterations] = ev.data;

	// Initialize our state

	var s = new SynchronicInt32(sab, 0);
	var iab = new Int32Array(sab, locIdx, 1);

	// Let the master know we're ready to go

	postMessage("ready");

	var x = 0;
	for ( var i=0 ; i < iterations ; i++ ) {
	    s.expectUpdate(x, Number.POSITIVE_INFINITY);
	    iab[0]++;
	    x = s.add(1)+1;
	}

	console.log("Worker exiting");
    };

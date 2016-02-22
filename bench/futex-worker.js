/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

onmessage =
    function (ev) {
	var [sab, sabIdx, locIdx, iterations, who] = ev.data;

	var s = new Int32Array(sab, sabIdx, 1);	  // "sync" location
	var iab = new Int32Array(sab, locIdx, 1); // "work" location

	var start = Date.now();

	msg("Worker " + who + " ready");
	var x = 0;
	for ( var i=0 ; i < iterations ; i++ ) {
	    if (who == 0) {
		Atomics.futexWait(s, 0, x++);
		iab[0]++;
		Atomics.store(s, 0, ++x);
		Atomics.futexWake(s, 0, Number.POSITIVE_INFINITY);
	    }
	    else {
		iab[0]++;
		Atomics.store(s, 0, ++x);
		Atomics.futexWake(s, 0, Number.POSITIVE_INFINITY);
		Atomics.futexWait(s, 0, x++);
	    }
	}
	msg("Worker " + who + " done");

	if (who == 1) {
	    msg("Counter: " + s[0]);
	    msg("Should be " + iterations*2 + ": " + iab[0]);
	    msg(Math.round(1000 * (2*iterations) / (Date.now() - start)) + " messages/s");
	}

	msg("Worker " + who + " exiting");
    };

function msg(s) {
    postMessage(s);
}

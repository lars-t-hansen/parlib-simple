/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

onmessage =
    function (ev) {
	var [sab, syncOffset, workOffset, iterations, who] = ev.data;

	var sync = new Int32Array(sab, syncOffset, 1);
	var work = new Int32Array(sab, workOffset, 1);

	var start = Date.now();

	msg("Worker " + who + " ready");
	var x = 0;
	for ( var i=0 ; i < iterations ; i++ ) {
	    if (who == 0) {
		Atomics.expectUpdate(sync, 0, x++);
		work[0]++;
		Atomics.storeNotify(sync, 0, ++x);
	    }
	    else {
		work[0]++;
		Atomics.storeNotify(sync, 0, ++x);
		Atomics.expectUpdate(sync, 0, x++);
	    }
	}
	msg("Worker " + who + " done");

	if (who == 1) {
	    msg("Counter: " + sync[0]);
	    msg("Should be " + iterations*2 + ": " + work[0]);
	    msg(Math.round(1000 * (2*iterations) / (Date.now() - start)) + " messages/s");
	}

	msg("Worker " + who + " exiting");
    };

function msg(s) {
    postMessage(s);
}

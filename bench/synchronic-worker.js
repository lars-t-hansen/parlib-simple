/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

importScripts("worker-common.js", "synchronic-polyfill.js");

var smallWork = true;

onmessage =
    function (ev) {
	var [sab, syncOffset, workOffset, polyOffset, iterations, who] = ev.data;

	var sync = new Int32Array(sab, syncOffset, 1);
	var work = new Int32Array(sab, workOffset, 1);

	if (Synchronic.mustPolyfill())
	    Synchronic.polyfill(new Int32Array(sab, polyOffset, Synchronic.NUMLOCS));

	var start = Date.now();

	msg("Worker " + who + " ready");
	var x = 0;
	for ( var i=0 ; i < iterations ; i++ ) {
	    if (who == 0) {
		Atomics.expectUpdate(sync, 0, x++);
		work[0]+=doWork();
		Atomics.storeNotify(sync, 0, ++x);
	    }
	    else {
		work[0]+=doWork();
		Atomics.storeNotify(sync, 0, ++x);
		Atomics.expectUpdate(sync, 0, x++);
	    }
	}
	msg("Worker " + who + " done");

	if (who == 1) {
	    assertEqual(2*iterations, sync[0]);
	    if (smallWork)
		assertEqual(2*iterations, work[0]);
	    msg(Math.round(1000 * (2*iterations) / (Date.now() - start)) + " messages/s");
	}

	msg("Worker " + who + " exiting");
    };

var oldWork = 0;

var doWork =
    (smallWork ?

     // Small work - best case, more or less
     function() { return 1; } :
     // Big work - not an unreasonable amount for a critical section

     function() { return (oldWork = oldWork + fib(10)) & 15; });

// Trying to make it not obvious what's going on.

function fib(n) {
    if (n < 2)
	return n;
    return fibx(n-1) + fiby(n-2);
}

function fibx(n) {
    if (n < 2)
	return n;
    return fiby(n-1) + fibx(n-2);
}

function fiby(n) {
    if (n < 2)
	return n;
    return fib(n-1) + fib(n-2);
}

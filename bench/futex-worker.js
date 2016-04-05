/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

importScripts("worker-common.js");

onmessage =
    function (ev) {
	var [sab, sabIdx, locIdx, iterations, who] = ev.data;

	var s = new Int32Array(sab, sabIdx, 2);	  // "sync" locations (signal, counter)
	var iab = new Int32Array(sab, locIdx, 1); // "work" location

	var start = Date.now();

	msg("Worker " + who + " ready");
	var x = 0;
	for ( var i=0 ; i < iterations ; i++ ) {
	    if (who == 0) {
		expectUpdate(s, 0, x);
		x++;
		iab[0]++;
		storeNotify(s, 0, ++x);
	    }
	    else {
		iab[0]++;
		storeNotify(s, 0, ++x);
		expectUpdate(s, 0, x);
		x++;
	    }
	}
	msg("Worker " + who + " done");

	if (who == 1) {
	    assertEqual(iterations*2, s[0]);
	    assertEqual(iterations*2, iab[0]);
	    msg(Math.round(1000 * (2*iterations) / (Date.now() - start)) + " messages/s");
	}

	msg("Worker " + who + " exiting");
    };

function expectUpdate(s, idx, current) {
    if (spinWait(s, idx, current))
	return;
    while (Atomics.load(s, idx) == current) {
	// These counters are *hugely* important for performance when
	// using Atomics.pause(), which might indicate that the futex
	// implementation needs some work!  The counter radically
	// reduces the number of calls to wake().  It makes sense
	// that it should be faster not to call wake(), since most
	// of the time that call is not necessary - the spinning was
	// enough.  Even so, can we do something?  Can we add this
	// accounting to the futex system, for example?
	//
	// (In a lock situation we can spin also on unlock, to see if
	// somebody grabs the lock, but that does not apply here.)
	Atomics.add(s, idx+1, 1);
	Atomics.wait(s, idx, current);
	Atomics.sub(s, idx+1, 1);
    }
}

function storeNotify(s, idx, value) {
    Atomics.store(s, idx, value);
    if (Atomics.load(s, idx+1))
	Atomics.wake(s, idx, 1);
}

function spinWaitPause(s, idx, current) {
    for (let i=0 ;; i++ ) {
	if (Atomics.load(s, idx) != current)
	    return true;
	if (!Atomics.pause(i))
	    return false;
    }
}

function spinWaitNoPause(s, idx, current) {}

var spinWait = (Atomics.pause ? spinWaitPause : spinWaitNoPause);

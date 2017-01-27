/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// STALE

// Test 1.
//
// This creates some workers and then sets up SynchronicMasterUpdates
// and SynchronicWorkerUpdates objects as a communication channel.
//
// Initially the workers all listen on the SynchronicMasterUpdates.
// The values transmitted on this channel will be worker IDs.  When a
// worker observes its own ID on the channel, it goes off and does
// some work and then writes its ID to the SynchronicWorkerUpdates
// channel and goes back to waiting.  The master will listen on that
// channel and when it sees that a worker has completed its task it
// will send the next worker ID to the workers.  And so on.
//
// This more or less just tests basic functionality.  All the workers
// will awake when the master writes a value and will then need to
// check the value and to listen again if the value is for some other
// worker.

"use strict";

const DEBUG = true;

const numWorkers = 3;
const iterations = 10;

const alloc = 256;
const asOffset = 0;

const sab = new SharedArrayBuffer(alloc);

const AS = new AsymmetricSynchronic(sab, asOffset, true);

for ( let i=1 ; i <= numWorkers ; i++ ) {
    let w = new Worker("test-asymmetric-synchronic-worker.js");
    w.postMessage(["init", i, sab, asOffset]);
    w.onmessage = handleMsg;
}

function handleMsg(ev) {
    if (AsymmetricSynchronic.filterEvent(ev))
	return;
    msg(ev.data);
}

let iter = 0;
let next = 0;

function runTest() {
    nextWorker();
}

function nextWorker() {
    if (iter == iterations)
	return;
    iter++;
    let last = Math.abs(AS.load());
    if (DEBUG)
	msg("nextWorker invoked, last=" + last); // 0 the first time, then 1, 2, 3, 1, 2, 3, ...
    let wanted = next + 1;
    AS.store(wanted);
    next = (next + 1) % numWorkers;
    AS.callWhenEquals(-wanted,
		      function handle() {
			  let v = 0;
			  if ((v = AS.load()) != -wanted) {
			      msg("Callback invoked but with unwanted value " + v + ", wanted " + -wanted);
			      AS.callWhenUpdated(last, handle);
			  }
			  else {
			      msg("Callback invoked with wanted value");
			      nextWorker();
			  }
		      });
}

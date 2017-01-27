/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Master producer, worker consumers.
//
// The data are 4+n-word bundles: iter, n, fib(n), fib(n-3), 0, 1, ..., n-1

// The worker can compute fib(n-3) from n and compare.

const numWorkers = 4;
const iterations = 200;

const alloc = 2048;

const sab = new SharedArrayBuffer(alloc);

const MPIQ = new MasterProducerIntQueue(sab, 0, alloc, true);

for ( let i=1 ; i <= numWorkers ; i++ ) {
    let w = new Worker("test-asymmetric-intqueue-m2w-worker.js");
    w.postMessage(["init", i, sab, 0, alloc, iterations]);
    w.onmessage = handleMsg;
}

let numReceived = 0;
let received = [];

function handleMsg(ev) {
    if (AsymmetricSynchronic.filterEvent(ev))
	return;
    if (Array.isArray(ev.data) && ev.data[0] === "phase1") {
	msg(ev.data.toSource());
	let data = ev.data[2];
	let id = ev.data[1];
	for ( let i=0 ; i < data.length ; i++ ) {
	    if (typeof received[data[i]] == "number")
		console.log("(1) Duplicate item: " + data[i]);
	    received[data[i]] = id;
	}
	if (++numReceived < numWorkers)
	    return;
	for ( let i=0 ; i < iterations*2 ; i++ ) {
	    if (typeof received[i] != "number")
		console.log("(1) Missing item: " + i);
	}
	console.log("Phase 1 finished");
	return;
    }
    msg(ev.data);
}

let iter = 0;
let sentinels = 0;
let phase = 1;

function runTest() {
    phase1();
}

let ds = [];

function phase1() {
    if (iter == iterations) {
	if (phase == 1) {
	    iter = 0;
	    phase = 2;
	    return phase1();
	}
	if (sentinels == numWorkers)
	    return;
	++sentinels;
	return putItem([0, 0, 0, 0], phase1);
    }
    iter++;
    let n = (iter % 8) + 3;
    let d;
    if (phase == 1) {
	d = [iter-1, n, fib(n), fib(n-3)];
	for ( let i=0 ; i < n ; i++ )
	    d.push(i);
	ds.push(d);
    }
    else {
	d = ds[iter-1];
	d[0] += iterations;
    }
    return putItem(d, phase1);
}

function putItem(item, k) {
    if (MPIQ.putOrFail(item)) {
	//console.log("Item was put: " + item);
	return k();
    }
    //console.log("Item was delayed: " + item);
    return MPIQ.callWhenCanPut(item.length, () => putItem(item, k));
}

function fib(n) {
    if (n < 2)
	return n;
    return fib(n-1) + fib(n-2);
}


/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Test the Lock and Cond types.
//
// Create K workers that share a single-consumer, multiple-producer
// bounded buffer with the master.
//
// The workers will each produce M elements with values ID+(n*K) into
// the buffer and then quit, where ID is the worker ID in the range
// [0,K-1].
//
// The master will read the elements and make sure, in the end, that
// it has received all the elements in the range [0..K*M-1].

var bufIdx = 0;                 // Start of buffer - this must be 0, for simplicity
var bufSize = 10;               // Number of elements in buffer
var availIdx = bufIdx+bufSize;  // Number of available values
var leftIdx = availIdx+1;       // Left end of queue (extract)
var rightIdx = leftIdx+1;       // Right end of queue (insert)
var lockIdx = rightIdx+1;       // Lock data
var nonfullIdx = lockIdx+Lock.NUMINTS;     // 'Nonfull' cond data
var nonemptyIdx = nonfullIdx+Cond.NUMINTS; // 'Nonempty' cond data
var iabSize = nonemptyIdx+Cond.NUMINTS;
var numWorkers = 3;
var numElem = 100;              // Number of elements to produce, per worker
var lock;
var nonfull;
var nonempty;

var iab = new Int32Array(new SharedArrayBuffer(iabSize*Int32Array.BYTES_PER_ELEMENT));
Lock.initialize(iab, lockIdx);
Cond.initialize(iab, nonfullIdx);
Cond.initialize(iab, nonemptyIdx);

function runTest() {
    var readies = 0;
    for ( var id=0 ; id < numWorkers ; id++ ) {
        var w = new Worker("test-lock-worker.js");
        w.onmessage =
            function (ev) {
                msg(String(ev.data));
                if (ev.data.indexOf("ready ") == 0) {
                    ++readies;
                    if (readies == numWorkers)
                        setTimeout(consumer, 0);
                }
            };
        w.postMessage([iab.buffer, bufIdx, bufSize, availIdx, leftIdx, rightIdx, lockIdx, nonfullIdx, nonemptyIdx, numElem, numWorkers, id]);
    }
    lock = new Lock(iab, lockIdx);
    nonfull = new Cond(lock, nonfullIdx);
    nonempty = new Cond(lock, nonemptyIdx);
}

function consumer() {
    msg("running: master");

    // Note this code assumes bufIdx == 0
    var consumed = 0;
    var check = new Int32Array(numWorkers*numElem);
    while (consumed < numWorkers*numElem) {
        lock.lock();
        // Wait until there's a value
        while (iab[availIdx] == 0)
            nonempty.wait();
        var left = iab[leftIdx];
        var elt = iab[left];
        iab[leftIdx] = (left+1) % bufSize;
        check[elt]++;
        // If a producer might be waiting on a slot, send a wakeup
        if (bufSize-(--iab[availIdx]) <= numWorkers)
            nonfull.wake();
        lock.unlock();
        ++consumed;
    }
    msg("Checking " + numWorkers*numElem + " elements");
    for ( var i=0 ; i < numWorkers*numElem ; i++ )
        if (check[i] != 1)
            msg("Failed at element " + i + ": " + check[i]);
    msg("done: master");
}

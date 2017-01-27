/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Test the Buffer type.
// 2015-01-19 / lhansen@mozilla.com
//
// Create K workers that share a buffer with the master.
//
// The workers will each produce M elements with values ID+(n*K) into
// the buffer and then quit, where ID is the worker ID in the range
// [0,K-1].
//
// The master will read the elements and make sure, in the end, that
// it has received all the elements in the range [0..K*M-1].

var qIdx = 0;                 // Start of buffer
var qSize = 10;               // Number of elements in buffer
var bufferIdx = qIdx+qSize;
var iabSize = bufferIdx+Buffer.NUMINTS;
var numWorkers = 3;
var numElem = 100;              // Number of elements to produce, per worker
var q;

var iab = new Int32Array(new SharedArrayBuffer(iabSize*Int32Array.BYTES_PER_ELEMENT));
Buffer.initialize(iab, bufferIdx);

function runTest() {
    q = new Buffer(iab, bufferIdx, iab, qIdx, qSize);

    // Create numWorkers workers, share the memory with them, and wait
    // for them all to report back that they're running.  Once they're
    // all up, call consumer().

    var readies = 0;
    for ( var id=0 ; id < numWorkers ; id++ ) {
        var w = new Worker("test-buffer-worker.js");
        w.onmessage =
            function (ev) {
                msg(String(ev.data));
                if (ev.data.indexOf("ready ") == 0) {
                    ++readies;
                    if (readies == numWorkers)
                        setTimeout(consumer, 0);
                }
            };
        w.postMessage([iab.buffer, qIdx, qSize, bufferIdx, numElem, numWorkers, id]);
    }
}

function consumer() {
    msg("running: master");

    // Consume data and account for the received values in a local buffer.

    var consumed = 0;
    var check = new Int32Array(numWorkers*numElem);
    while (consumed < numWorkers*numElem) {
	var elt = q.take();
        check[elt]++;
        ++consumed;
    }

    // Check that we received one of each value.

    msg("Checking " + numWorkers*numElem + " elements");
    for ( var i=0 ; i < numWorkers*numElem ; i++ )
        if (check[i] != 1)
            msg("Failed at element " + i + ": " + check[i]);
    msg("done: master");
}

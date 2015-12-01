/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// 2015-01-19 / lhansen@mozilla.com

importScripts("../src/lock.js",
	      "../src/buffer.js");

var DEBUG = true;

onmessage =
    function (ev) {
        var [sab, qIdx, qSize, bufferIdx, numElem, numWorkers, myID] = ev.data;
        var iab = new Int32Array(sab);
        var q = new Buffer(iab, bufferIdx, iab, qIdx, qSize);

	// Report back that we're running.

        postMessage("ready " + myID);

	// Produce elements and insert them into the queue.

        var produced = 0;
        while (produced < numElem) {
	    var elt = produced*numWorkers + myID;
	    q.put(elt);
	    ++produced;
        }

        postMessage("done: " + myID);
    };

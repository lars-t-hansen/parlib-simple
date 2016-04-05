/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// 2015-01-12 / lhansen@mozilla.com

importScripts("../util/shim.js",
	      "../src/message.js",
	      "../src/asymmetric-barrier.js");

dispatchMessage(self, "setup", function (data) {
    var [_, sab, numIter, barrierIdx, barrierID, addendIdx, segmentBase, segmentSize] = data;
    var iab = new Int32Array(sab);
    var dab = new Float64Array(sab);
    var barrier = new WorkerBarrier(iab, barrierIdx, barrierID);

    postMessage([numIter, barrierIdx, barrierID, addendIdx, segmentBase, segmentSize].join(" "));
    for ( var i=0 ; i < numIter ; i++ ) {
	barrier.enter();
	var addend = dab[addendIdx];
	for ( var j=0; j < segmentSize ; j++ )
	    dab[segmentBase + j] += addend;
    }

    postMessage("done " + segmentBase);
    barrier.enter();
});

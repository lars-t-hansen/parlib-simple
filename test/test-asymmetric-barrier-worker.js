// 2015-01-12 / lhansen@mozilla.com

importScripts("../src/asymmetric-barrier.js");

onmessage =
    function (ev) {
	var [sab, numIter, barrierIdx, barrierID, addendIdx, segmentBase, segmentSize] = ev.data;
        var iab = new SharedInt32Array(sab);
	var dab = new SharedFloat64Array(sab);
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
    };

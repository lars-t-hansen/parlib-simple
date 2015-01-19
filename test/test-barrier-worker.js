// 2015-01-12 / lhansen@mozilla.com

importScripts("barrier.js");

onmessage =
    function (ev) {
	var [sab, bufIdx, bufSize, barrierIdx, numSegments, segmentSize, myID] = ev.data;
        var iab = new SharedInt32Array(sab);
        var barrier = new Barrier(iab, barrierIdx);

	setTimeout(function () {
	    postMessage("ready " + myID);

            // Note this code assumes bufIdx == 0
	    var seg = (myID - 1);
	    for ( var i=0 ; i < numSegments ; i++ ) {
		for ( var j=0 ; j < segmentSize ; j++ )
		    iab[seg*segmentSize + j] = ~iab[seg*segmentSize + j];
		barrier.enter();
		for ( var j=0 ; j < segmentSize ; j++ ) {
		    iab[seg*segmentSize + j] = ~iab[seg*segmentSize + j];
		    iab[seg*segmentSize + j] += myID;
		}
		seg = (seg+1) % numSegments;
		barrier.enter();
	    }

	    postMessage("done " + myID);
	}, 0);
    };

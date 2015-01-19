// Test the Barrier type.
// 2015-01-12 / lhansen@mozilla.com
//
// Create K workers that each add their ID to the elements in the
// range of a shared array, and then enter a barrier.  On the next
// round they add their ID to the next range of the shared array, and
// so on, until all have done all the ranges.  The shared array's
// elements should now all have the sum of all the IDs.
//
// The main thread participates as one of the computing agents.
//
// In order to catch races - where the barrier is not obeyed - we
// double the number of barriers, and for each segment first invert
// the value, do a barrier, then invert it again, then add the value.
//
// (This still feels like a fairly weak test.)

var numWorkers = 3;
var numSegments = numWorkers + 1;
var segmentSize = 10;
var bufIdx = 0;
var bufSize = segmentSize*numSegments;
var barrierIdx = bufIdx+bufSize;
var iabSize = barrierIdx + Barrier.NUMINTS;

var iab = new SharedInt32Array(iabSize);
Barrier.initialize(iab, barrierIdx, numSegments);

function runTest() {
    var readies = 0;
    for ( var id=0 ; id < numWorkers ; id++ ) {
        var w = new Worker("test-barrier-worker.js");
        w.onmessage =
            function (ev) {
                console.log(String(ev.data));
                if (ev.data.indexOf("ready ") == 0) {
                    ++readies;
                    if (readies == numWorkers)
                        setTimeout(worker, 0);
                }
            };
	// Workers have ID 1..numWorkers, master has ID numWorkers+1
        w.postMessage([iab.buffer, bufIdx, bufSize, barrierIdx, numSegments, segmentSize, id+1],
                      [iab.buffer]);
    }

    barrier = new Barrier(iab, barrierIdx);
}

function worker() {
    console.log("running: master");
    var myID = numWorkers+1;
    
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
    
    console.log("Checking " + numSegments*segmentSize + " elements");
    var expect = (numSegments*(numSegments+1)/2)|0;
    for ( var i=0 ; i < numSegments*segmentSize ; i++ )
        if ((iab[i]|0) != expect)
            console.log("Failed at element " + i + ": " + (iab[i]|0) + " " + expect);
    console.log("done: master");
}

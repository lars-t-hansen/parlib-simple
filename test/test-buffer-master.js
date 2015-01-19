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

var iab = new SharedInt32Array(iabSize);
Buffer.initialize(iab, bufferIdx);

function runTest() {
    q = new Buffer(iab, bufferIdx, iab, qIdx, qSize);

    var readies = 0;
    for ( var id=0 ; id < numWorkers ; id++ ) {
        var w = new Worker("test-buffer-worker.js");
        w.onmessage =
            function (ev) {
                console.log(String(ev.data));
                if (ev.data.indexOf("ready ") == 0) {
                    ++readies;
                    if (readies == numWorkers)
                        setTimeout(consumer, 0);
                }
            };
        w.postMessage([iab.buffer, qIdx, qSize, bufferIdx, numElem, numWorkers, id],
                      [iab.buffer]);
    }
}

function consumer() {
    console.log("running: master");
    
    var consumed = 0;
    var check = new Int32Array(numWorkers*numElem);
    while (consumed < numWorkers*numElem) {
	var elt = q.take();
        check[elt]++;
        ++consumed;
    }
    console.log("Checking " + numWorkers*numElem + " elements");
    for ( var i=0 ; i < numWorkers*numElem ; i++ )
        if (check[i] != 1)
            console.log("Failed at element " + i + ": " + check[i]);
    console.log("done: master");
}

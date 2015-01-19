// 2015-01-19 / lhansen@mozilla.com

importScripts("lock.js", "buffer.js");

var DEBUG = true;

onmessage =
    function (ev) {
        var [sab, qIdx, qSize, bufferIdx, numElem, numWorkers, myID] = ev.data;
        var iab = new SharedInt32Array(sab);
        var q = new Buffer(iab, bufferIdx, iab, qIdx, qSize);

        postMessage("ready " + myID);
        
        var produced = 0;
        while (produced < numElem) {
	    var elt = produced*numWorkers + myID;
	    q.put(elt);
	    ++produced;
        }

        postMessage("done: " + myID);
    };

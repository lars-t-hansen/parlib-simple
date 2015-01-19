// 2015-01-12 / lhansen@mozilla.com

importScripts("lock.js");

var DEBUG = true;

onmessage =
    function (ev) {
        var [sab, bufIdx, bufSize, availIdx, leftIdx, rightIdx, lockIdx, nonfullIdx, nonemptyIdx, numElem, numWorkers, myID] = ev.data;
        var iab = new SharedInt32Array(sab);
        var lock = new Lock(iab, lockIdx);
        var nonfull = new Cond(lock, nonfullIdx);
        var nonempty = new Cond(lock, nonemptyIdx);

        setTimeout(function () {
            postMessage("ready " + myID);
        
            // Note this code assumes bufIdx == 0
            var produced = 0;
            var sent = [];
            while (produced < numElem) {
                var elt = produced*numWorkers + myID;
                lock.lock();
                // Wait until there's a slot
                var waits = 0;
                while (iab[availIdx] == bufSize) {
                    --waits;
                    nonfull.wait();
                }
                if (DEBUG && waits)
                    sent.push(waits);
                var right = iab[rightIdx];
                iab[right] = elt;
                iab[rightIdx] = (right+1) % bufSize;
                if (DEBUG)
                    sent.push(right);
                // If the consumer might be waiting on a value, send a wakeup
                if (iab[availIdx]++ == 0)
                    nonempty.wake();
                lock.unlock();
                ++produced;
            }

            // The DEBUG message contains negative numbers where a
            // worker had to wait, indicating the number of times
            // through the wait loop.  Large numbers indicate high
            // contention.  On my system I'm seeing numbers around -70
            // sometimes, indicating that once a worker manages to
            // find its groove it stays there until it's done.  A more
            // expensive computation might change that.

            postMessage("done: " + myID + " " + (DEBUG ? sent.join(' ') : ""));
	}, 0);
    };

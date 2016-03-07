importScripts("../src/float64atomics.js",
	      "../src/message.js",
	      "../src/asymmetric-barrier.js");

onmessage = function (ev) {
    var [sab, barrierIdx, barrierId, accIdx, atomicIdx, iterations] = ev.data;
    var dab = new Float64Array(sab);
    var iab = new Int32Array(sab);
    var barrier = new WorkerBarrier(iab, barrierIdx, barrierId);

    Atomics.float64Init(iab, atomicIdx);

    postMessage("Worker ready");
    barrier.enter();
    postMessage("Worker running");
    // Test add
    for ( var i=0 ; i < iterations ; i++ )
	Atomics.float64Add(dab, accIdx, 1.0);
    postMessage("Worker done");
    barrier.enter();
}

importScripts("../src/asymmetric-futex.js");

onmessage = function (ev) {
    var [tag, sab, id, testloc] = ev.data;
    var iab = new SharedInt32Array(sab);
    var wf = new WorkerFutex(iab, id);

    Atomics.futexWait(iab, testloc, 0, 1000);
    wf.wake(testloc, 1);

    Atomics.futexWait(iab, testloc, 0, 1000);
    wf.wake(testloc, 2);

    Atomics.futexWait(iab, testloc, 0, 1000);
    wf.wake(testloc, 1);
}

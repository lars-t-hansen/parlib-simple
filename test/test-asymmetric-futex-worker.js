/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

importScripts("../util/shim.js", "../src/asymmetric-futex.js");

onmessage = function (ev) {
    var [tag, sab, id, testloc] = ev.data;
    var iab = new Int32Array(sab);
    var wf = new WorkerFutex(iab, id);

    // TODO: out-of-range wake counts
    // TODO: also see the -master code

    Atomics.wait(iab, testloc, 0, 1000);
    wf.wake(testloc, 1);

    Atomics.wait(iab, testloc, 0, 1000);
    wf.wake(testloc, 2);

    Atomics.wait(iab, testloc, 0, 1000);
    wf.wake(testloc, 1);
}

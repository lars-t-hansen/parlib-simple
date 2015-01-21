/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

importScripts("../src/asymmetric-lock.js",
	      "asymmetric-lock-computation.js");

onmessage =
    function (ev) {
	var [sab, numIter, fab_byteOffset, iab_byteOffset, iab_length, ID] = ev.data;
	const fab = new SharedFloat64Buffer(sab, fab_byteOffset, 1);
	const iab = new SharedInt32Array(sab, iab_byteOffset, iab_length);
	const flagIdx = 0;	// in iab
	const lockIdx = 1;	// in iab
	const lock = new WorkerLock(iab, lockIdx);

	postMessage("ready " + ID);

	for (var iter=0 ; iter < numIter ; iter++ ) {
	    var result = compute();
	    lock.lock();
	    if (Atomics.or(iab, flagIdx, (1 << ID)) != 0)
		throw new Error("Flag found to be nonzero on entry: " + ID);
	    fab[0] += mangleResult(result);
	    if (Atomics.and(iab, flagIdx, ~(1 << ID)) != (1 << ID))
		throw new Error("Flag found to be nonzero on exit: " + ID);
	    lock.unlock();
	}

	postMessage("done: " + ID);
    };

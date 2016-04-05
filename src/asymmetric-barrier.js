/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// REQUIRE:
//   message.js

// Asymmetric barrier synchronization.
// 2015-01-19 / v1
// 2016-03-07 / v2, handle message events differently, see addWorker()

// MasterBarrier / WorkerBarrier.
//
// This is a simple master/worker barrier that is mapped to locations
// within a shared integer array.
//
// The purpose of this barrier is to allow the master--the main thread
// of the window--not to block, but to receive a callback when the
// workers have all entered the barrier.
//
// Overview
// --------
// The master and workers all create private barrier objects, which
// reference the same working locations in shared memory.  When the
// workers have all entered the barrier the master receives a
// callback.  The master must then release the workers again for them
// to resume computing.
//
// Usage
// -----
// Client code in the master must create a MasterBarrier object per
// barrier.
//
// The workers must each create a WorkerBarrier on the same shared
// locations and with the same ID as the master barrier.  The
// WorkerBarriers must not be created until after the MasterBarrier
// constructor has returned.
//
// Client code in the master must call MasterBarrier.addWorker(w) on
// each worker w to install event handling machinery in that worker.
//
// The application is responsible for allocating the locations in the
// integer array and communicating those and the ID to the workers.
//
// The number of consecutive int32 array locations needed is given by
// MasterBarrier.NUMINTS.

"use strict";

// Create the master side of a barrier.
//
// - 'iab' is an Int32Array on shared memory.
// - 'ibase' is the first of MasterBarrier.NUMINTS consecutive locations
//   within 'iab'
// - 'ID' identifies the barrier globally
// - 'numWorkers' is the number of workers that will coordinate
// - 'callback' is the function that is to be called when the workers
//   are all waiting in the barrier with this ID.
//
// 'iab', 'ibase', 'ID', and 'numWorkers' are exposed on the object.

function MasterBarrier(iab, ibase, ID, numWorkers, callback) {
    this.iab = iab;
    this.ibase = ibase;
    this.numWorkers = numWorkers;
    this.ID = ID;

    const counterLoc = ibase;
    const seqLoc = ibase+1;

    iab[counterLoc] = numWorkers;
    iab[seqLoc] = 0;
    MasterBarrier._callbacks[ID] = callback;
}

// Call this with any worker w that participates in any barrier to
// install message handling machinery for the barrier.  One invocation
// per worker is enough.

MasterBarrier.addWorker = function (w) {
    dispatchMessage(w, "MasterBarrier.dispatch", function (data) {
	const id = data[1];
	const cb = MasterBarrier._callbacks[id];
	if (!cb)
	    throw new Error("Unknown barrier ID: " + id);
	return cb();
    });
}

// PRIVATE.  Maps barrier IDs to callback functions.

MasterBarrier._callbacks = {};

// The number of consecutive locations in the integer array needed for
// the barrier.

MasterBarrier.NUMINTS = 2;

// Return true iff the workers are all waiting in the barrier.
//
// Note that this is racy; if the result is false the workers may all
// in fact be waiting because the last worker could have entered after
// the check was performed but before isQuiescent() returned.

MasterBarrier.prototype.isQuiescent =
    function () {
	const iab = this.iab;
	const counterLoc = this.ibase;

	return Atomics.load(iab, counterLoc) == 0;
    };

// If the workers are not all waiting in the barrier then return false.
// Otherwise release them and return true.
//
// Note that if the result is false the workers may all in fact be
// waiting because the last worker could have entered after the check
// was performed but before isQuiescent() returned.

// The barrier is immediately reusable after the workers are released.

MasterBarrier.prototype.release =
    function () {
	if (!this.isQuiescent())
	    return false;

	const iab = this.iab;
	const counterLoc = this.ibase;
	const seqLoc = counterLoc+1;
	const numWorkers = this.numWorkers;

	Atomics.store(iab, counterLoc, numWorkers);
	Atomics.add(iab, seqLoc, 1);
	Atomics.wake(iab, seqLoc, numWorkers);
	Atomics.add(iab, seqLoc, 1);
	return true;
    };

// Create the worker side of a barrier.
//
// - 'iab' is an Int32Array on shared memory
// - 'ibase' is the first of several consecutive locations within 'iab'
// - 'ID' identifies the barrier globally
//
// 'iab', 'ibase', and 'ID' are all exposed on the object.

function WorkerBarrier(iab, ibase, ID) {
    this.iab = iab;
    this.ibase = ibase;
    this.ID = ID;
}

// Enter the barrier.  This call will block until the master has
// released all the workers.

WorkerBarrier.prototype.enter =
    function () {
	const iab = this.iab;
	const counterLoc = this.ibase;
	const seqLoc = counterLoc+1;
	const ID = this.ID;

	const seq = Atomics.load(iab, seqLoc);
	if (Atomics.sub(iab, counterLoc, 1) == 1)
	    postMessage(["MasterBarrier.dispatch", ID]);
	Atomics.wait(iab, seqLoc, seq, Number.POSITIVE_INFINITY);
	while (Atomics.load(iab, seqLoc) & 1)
	    ;
    };

// Asymmetric barrier synchronization.
// 2013-12-03 / lhansen@mozilla.com

// MasterBarrier / WorkerBarrier.
//
// This is a simple master/worker barrier that is mapped to locations
// within a shared integer array.
//
// Overview
// --------
// The master and workers all create private barrier objects, which
// reference some working locations in shared memory.  When the
// workers have all entered the barrier the master receives a
// callback.  The master must then release the workers again for them
// to resume computing.
//
// Usage
// -----
// The master must create a MasterBarrier, and then ensure that
// Master.dispatch is invoked when a worker's onmessage handler
// receives a message that the workers are all in the barrier.  That
// message is an array of the form ["MasterBarrier.dispatch", ID]
// where ID is the barrier ID.
//
// The workers must each create a WorkerBarrier on the same shared
// locations and with the same ID as the master barrier.  The
// WorkerBarriers must not be created until after the MasterBarrier
// constructor has returned.
//
// The application is responsible for allocating the locations in the
// integer array and communicating those and the ID to the workers.
//
// The number of consecutive array locations needed is given by
// MasterBarrier.NUMLOCS.

"use strict";

// Create the master side of a barrier.
//
// - 'iab' is a SharedInt32Array
// - 'ibase' is the first of several consecutive locations within 'iab'
// - 'ID' identifies the barrier globally
// - 'numWorkers' is the number of workers that will coordinate
// - 'callback' is the function that is to be called when the workers
//   are all waiting in the barrier with this ID.

function MasterBarrier(iab, ibase, ID, numWorkers, callback) {
    this.iab = iab;
    this.ibase = ibase;
    this.numWorkers = numWorkers;

    const counterLoc = ibase;
    const seqLoc = ibase+1;

    iab[counterLoc] = numWorkers;
    iab[seqLoc] = 0;
    MasterBarrier._callbacks[ID] = callback;
}

// PRIVATE.  Maps barrier IDs to callback functions.

MasterBarrier._callbacks = {};

// The number of consecutive locations in the integer array needed for
// the barrier.

MasterBarrier.NUMLOCS = 2;

// The master's onmessage handler must call dispatch() to invoke the
// callback for the given barrier ID, see introduction above.

MasterBarrier.dispatch =
    function (id) {
	const cb = MasterBarrier._callbacks[id];
	if (!cb)
	    throw new Error("Unknown barrier ID: " + id);
	return cb();
    };

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
	Atomics.futexWake(iab, seqLoc, numWorkers);
	return true;
    };

// Create the worker side of a barrier.
//
// - 'iab' is a SharedInt32Array
// - 'ibase' is the first of several consecutive locations within 'iab'
// - 'ID' identifies the barrier globally

function WorkerBarrier(iab, ibase, ID) {
    this.iab = iab;
    this.ibase = ibase;
    this.ID = ID;
}

// Enter the barrier.  This call will block until the master releases
// the workers.

WorkerBarrier.prototype.enter =
    function () {
	const iab = this.iab;
	const counterLoc = this.ibase;
	const seqLoc = counterLoc+1;
	const ID = this.ID;

	const seq = Atomics.load(iab, seqLoc);
	if (Atomics.sub(iab, counterLoc, 1) == 1)
	    postMessage(["MasterBarrier.dispatch", ID]);
	Atomics.futexWait(iab, seqLoc, seq, Number.POSITIVE_INFINITY);
    };



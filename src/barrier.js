/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A simple barrier sync.

"use strict";

//////////////////////////////////////////////////////////////////////
//
// Barriers.
//
// Barriers are JS objects that use some shared memory for private
// data.  The number of shared int32 locations needed is given by
// Barrier.NUMINTS.  The shared memory for a barrier should be
// initialized once by calling Barrier.initialize() on the memory,
// before constructing the first Barrier object in any agent.

// Implementation note: This barrier predates the Synchronic facility
// and is therefore implemented on top of bare atomics and futexes.
// It could equally well be implemented on top of Synchronic.

// Create a barrier object.
//
// 'iab' is an Int32Array on shared memory.
// 'ibase' is the first of Barrier.NUMINTS slots within iab reserved
// for the barrier.
//
// iab and ibase will be exposed on the Barrier.
function Barrier(iab, ibase) {
    if (!(iab instanceof Int32Array && ibase|0 == ibase && ibase >= 0 && ibase+Barrier.NUMINTS <= iab.length))
	throw new Error("Bad arguments to Barrier constructor: " + iab + " " + ibase);
    this.iab = iab;
    this.ibase = ibase;
}

// Number of shared Int32 locations needed by the barrier.
Barrier.NUMINTS = 3;

// Initialize the shared memory for a barrier.
//
// 'iab' is an Int32Array on shared memory.
// 'ibase' is the first of Barrier.NUMINTS slots within iab reserved
// for the barrier.
// 'numAgents' is the number of participants in the barrier.
//
// Returns 'ibase'.
Barrier.initialize =
    function (iab, ibase, numAgents) {
	if (!(iab instanceof Int32Array &&
	      ibase|0 == ibase &&
	      ibase >= 0 &&
	      ibase+Barrier.NUMINTS <= iab.length &&
	      numAgents|0 == numAgents))
	{
	    throw new Error("Bad arguments to Barrier initializer: " + iab + " " + ibase + " " + numAgents);
	}

	const counterLoc = ibase;
	const seqLoc = ibase+1;
	const numAgentsLoc = ibase+2;

	Atomics.store(iab, counterLoc, numAgents);
	Atomics.store(iab, seqLoc, 0);
	Atomics.store(iab, numAgentsLoc, numAgents);

	return ibase;
    };

// Enter the barrier.  This will block until all agents have entered
// the barrier, at which point all agents are automatically released.
// The barrier is then immediately usable.
Barrier.prototype.enter =
    function () {
	const iab = this.iab;
	const ibase = this.ibase;

	const counterLoc = ibase;
	const seqLoc = ibase+1;
	const numAgentsLoc = ibase+2;

	// The sequence number must be read before the check, otherwise
	// when we wait there is the possibility that the waiting thread
	// will read the sequence number that has been updated by the
	// non-waiting thread, and incorrectly wait on that.
	const seq = Atomics.load(iab, seqLoc);
	if (Atomics.sub(iab, counterLoc, 1) == 1) {
	    const numAgents = iab[numAgentsLoc];
	    iab[counterLoc] = numAgents;
	    Atomics.add(iab, seqLoc, 1);
	    Atomics.wake(iab, seqLoc, numAgents-1);
	    Atomics.add(iab, seqLoc, 1);
	}
	else {
	    Atomics.wait(iab, seqLoc, seq, Number.POSITIVE_INFINITY);
	    // Wait until the master is done waking all threads
	    while (Atomics.load(iab, seqLoc) & 1)
		;
	}
    };

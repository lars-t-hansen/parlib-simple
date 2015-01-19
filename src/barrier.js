// A simple barrier sync.
// 2015-01-19 / lhansen@mozilla.com

//////////////////////////////////////////////////////////////////////
//
// Barriers.
//
// Barriers are JS objects that use some shared memory for private
// data.  The number of shared int32 locations needed is given by
// Barrier.NUMINTS.  The shared memory for a barrier should be
// initialized once by calling Barrier.initialize() on the memory,
// before constructing the first Barrier object in any agent.

// Create a barrier object.
//
// 'iab' is a SharedInt32Array.
// 'ibase' is the first of Barrier.NUMINTS slots within iab reserved
// for the barrier.
//
// iab and ibase will be exposed on the Barrier.
function Barrier(iab, ibase) {
    if (!(iab instanceof SharedInt32Array && ibase|0 == ibase && ibase >= 0 && ibase+Barrier.NUMINTS <= iab.length))
	throw new Error("Bad arguments to Barrier constructor: " + iab + " " + ibase);
    this.iab = iab;
    this.ibase = ibase;
}

// Number of shared Int32 locations needed by the barrier.
Barrier.NUMINTS = 3;

// Initialize the shared memory for a barrier.
//
// 'iab' is a SharedInt32Array.
// 'ibase' is the first of Barrier.NUMINTS slots within iab reserved
// for the barrier.
// 'numAgents' is the number of participants in the barrier.
//
// Returns 'ibase'.
Barrier.initialize =
    function (iab, ibase, numAgents) {
	if (!(iab instanceof SharedInt32Array && ibase|0 == ibase && ibase >= 0 && ibase+Barrier.NUMINTS <= iab.length && numAgents|0 == numAgents))
	    throw new Error("Bad arguments to Barrier initializer: " + iab + " " + ibase + " " + numAgents);

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

	if (Atomics.sub(iab, counterLoc, 1) == 1) {
	    const numAgents = iab[numAgentsLoc];
	    Atomics.store(iab, counterLoc, numAgents);
	    Atomics.add(iab, seqLoc, 1);
	    // The correctness of the wakeup call depends on the
	    // linear-queue behavior of wait and wake: we wake the
	    // numAgents-1 that are currently waiting, even if some
	    // agents might reenter the barrier and start waiting
	    // again before the waking is finished.
	    Atomics.futexWake(iab, seqLoc, numAgents-1);
	}
	else {
	    const seq = Atomics.load(iab, seqLoc);
	    Atomics.futexWait(iab, seqLoc, seq, Number.POSITIVE_INFINITY);
	}
    };

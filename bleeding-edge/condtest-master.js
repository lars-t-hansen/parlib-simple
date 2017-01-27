var sab = new SharedArrayBuffer(4096);
var ia = new Int32Array(sab);

var numAgents = 4;		// even

// Memory:
//   agent
//   ...
//   lock
//   datum

var BUFSIZ = 64;
var mem_agents = 1;
var mem_lock = mem_agents + (numAgents + 1) * Agent_INTS;
var mem_cond1 = mem_lock + Lock_INTS;
var mem_cond2 = mem_cond1 + Cond_INTS;
var mem_head = mem_cond2 + Cond_INTS; // Index into mem_buffer
var mem_tail = mem_head + 1;	      // Ditto
var mem_buffer = mem_tail + 1;
var mem_datum = mem_buffer + BUFSIZ;

Agent.setup(ia, mem_agents, 1);	// Master agent is agent #1 in slot 0
Lock.initialize(ia, mem_lock);
Cond.initialize(ia, mem_cond1);
Cond.initialize(ia, mem_cond2);

// The test: agent 1 pumps data into a queue, the other agents extract
// data from the queue almost as fast as they can.  There is a lock on
// the queue data, and two condition variables (spaceAvail,
// dataAvail).  The two condition variables use the same lock.
//
// The producer can either use notifyOne after each insertion or it
// can use notifyAll when it goes from empty to nonempty...

for ( var i=0 ; i < numAgents ; i++ ) {
    let w = new Worker("condtest-worker.js");
    w.postMessage([sab, mem_agents + (i+1)*Agent_INTS, i+2, mem_lock, mem_cond1, mem_cond2, mem_head, mem_tail, mem_buffer, BUFSIZ, mem_datum]);
    w.onmessage = workerDone;
}

var done = 0;

function workerDone() {
    //console.log("Worker is done");
    if (++done == numAgents) {
	for ( var i=0 ; i < numAgents / 2 ; i++ )
	    console.log("Result " + i + ": " + ia[mem_datum + i].toString(16));
    }
}

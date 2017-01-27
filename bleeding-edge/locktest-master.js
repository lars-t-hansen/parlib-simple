var sab = new SharedArrayBuffer(4096);
var ia = new Int32Array(sab);

var numAgents = 32;		// even

// Memory:
//   agent
//   ...
//   lock
//   datum

var mem_agents = 1;
var mem_lock = mem_agents + (numAgents + 1) * Agent_INTS;
var mem_datum = mem_lock + Lock_INTS;

Agent.setup(ia, mem_agents, 1);	// Master agent is agent #1 in slot 0
Lock.initialize(ia, mem_lock);

for ( var i=0 ; i < numAgents ; i++ ) {
    let w = new Worker("locktest-worker.js");
    w.postMessage([sab, mem_agents + (i+1)*Agent_INTS, i+2, mem_lock, mem_datum]);
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

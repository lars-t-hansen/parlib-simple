importScripts("lock.js");

onmessage = function (ev) {
    var [sab, mem_agent, id, mem_lock, mem_datum] = ev.data;
    var ia = new Int32Array(sab);
    Agent.setup(ia, mem_agent, id);
    var loc = mem_datum + Math.floor((id - 2) / 2);
    compute(new Lock(mem_lock), ia, loc, 1 << (16 * ((id-2) % 2)));
}

//var limit = 64*1024;
var limit = 16*1024-1;
//var limit = 10;

function compute(lock, ia, offs, k) {
    for ( var i=0 ; i < limit ; i++ ) {
	lock.lock();
	ia[offs] += k;
	lock.unlock();
    }
    postMessage("Worker done");
}

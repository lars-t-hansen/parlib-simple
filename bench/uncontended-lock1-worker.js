importScripts("../util/shim.js", "lock.js");

onmessage = function (ev) {
    let [ia, lockOffs, countOffs, iterations] = ev.data;
    let lock = new Lock(ia, lockOffs);
    let then = Date.now();
    for ( let i=0 ; i < iterations ; i++ ) {
	lock.lock();

	// "Small" workload
	//ia[countOffs]++;

	// "Medium" workload
	//ia[countOffs]+=g(h(i));

	// "Large" workload
	ia[countOffs]+=fib(i&7);

	lock.unlock();
    }
    let now = Date.now();
    postMessage("Time to execute: " + (now - then) + "ms");
}

function g(x) {
    return (x ^ 1) + 1;
}

function h(x) {
    return (x & 1) | 1;
}

function fib(n) {
    if (n < 2)
	return n;
    return fib(n-1) + fib(n-2);
}

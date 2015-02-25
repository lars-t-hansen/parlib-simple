load("../src/alloc.js");

var sab = new SharedArrayBuffer(1024*1024);

SharedAlloc.initialize(sab, 0, sab.byteLength);

var sa = new SharedAlloc(sab, 0);

var xa = sa.Int32Array;
var v, w, u;
/*
print("@" + (v = sa.allocInt32(4))*4);
print("  " + xa[v-2]);
print("  " + xa[v-1]);
print("@" + (w = sa.allocInt32(5))*4);
print("  " + xa[w-2]);
print("  " + xa[w-1]);
print("@" + (u = sa.allocInt32(4))*4);
print("  " + xa[u-2]);
print("  " + xa[u-1]);
sa.freeInt32(w);
sa.freeInt32(u);
sa.freeInt32(v);
var n = sa.allocInt32(5);
print(n*4);
var m = sa.allocInt32(4);
print(m*4);
var k = sa.allocInt32(4);
print(k*4);
sa._printFree();
var k = sa.allocInt32(4);
print(k*4);
var m = sa.allocInt32(254);	// Should be small (header+obj == 1024 bytes)
assertEq(m == 0, false);
sa.freeInt32(m);
var n = sa.allocInt32(255);	// Should be large (header+obj > 1024 bytes)
assertEq(n == 0, false);
sa.freeInt32(n);
sa._printFree();
sa._printBlockFree();
*/

// Stress test:
//
// Create a number of workers that allocate, poison, accumulate, and
// then free objects pseudo-randomly and keep doing that for quite a
// long time.
//
// Do this with all the allocators and deallocators.

// TODO: Another stress test that is important is for threads to
// exchange objects, so that objects allocated one place is freed
// another.

// TODO: Probably want to have some sort of memory consumption test,
// ie, in a steady state the heap should not grow.  That seems to be
// the case for the current stress test, even with coalescing
// unimplemented.  (Not really surprising: the local free lists get
// warmed up quickly to the relatively small live set, and the block
// allocator merges aggressively.)

// TODO: Performance test?

var numWorkers = 4;
var numObjs = 300000;
var numLive = 1000;
var workerID = 0;
var heapsize = 20*numWorkers;		// MB

var sab2 = new SharedArrayBuffer(heapsize*1024*1024);
SharedAlloc.initialize(sab2, 0, sab2.byteLength);
setSharedArrayBuffer(sab2);

var alloc2;
function run_test() {
    var a = new SharedAlloc(sab2, 0);
    alloc2 = a;
    var pop = new Array(numLive);
    var tag = new Array(numLive);
    var size = new Array(numLive);
    var allocs = [
	a.alloc8.bind(a),
	a.alloc16.bind(a),
	a.alloc32.bind(a),
	a.alloc64.bind(a)
    ];
    var frees = [
	a.free8.bind(a),
	a.free16.bind(a),
	a.free32.bind(a),
	a.free64.bind(a)
    ];
    var sizes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 17, 19, 23, 29, 40, 65,
		 130, 398, 1200, 4096, 4097, 8192, 8193, 16888/*, 97858*/];

    var X = workerID*811+7;
    var A = 1103515245;
    var C = 12345;
    var M = 0x7FFFFFFF;

    // This conception of poisoning is only valid when the same thread
    // frees the object!  But it could work if we just check that all
    // elements of an object have the same poison value.

    var P = nextRand() & 0x7F;
    P = (P ^ (P << 8) ^ (P << 16) ^ (P << 24));

    print("Poison = " + P.toString(16));
    for ( var i=0 ; i < numObjs ; i++ ) {
	var loc = nextRand() % numLive;
	check(loc);
	free(loc);
	var t = nextRand() % allocs.length;  	// Interpretation of length
	var z = nextSize();			// Length
	tag[loc] = t;
	size[loc] = z;
	pop[loc] = allocs[t](z);
	if (pop[loc] == 0)
	    throw new Error("ID=" + workerID + ": Allocation failure: tag=" + t + ", length=" + z);
	poison(loc);
    }
    for ( var i=0 ; i < numLive ; i++ ) {
	check(i);
	free(i);
    }

    print("Done: " + workerID);

    function poison(loc) {
	assertEq(pop[loc] != 0, true);
	var l = size[loc];
	var t = tag[loc];
	var x = pop[loc];
	var p;
	var arr;
	switch (t) {
	case 0: p = P & 0xFF; arr=a.Int8Array; break;
	case 1: p = P & 0xFFFF; arr=a.Int16Array; break;
	case 2: p = P; arr=a.Int32Array; break;
	case 3: p = P; arr=a.Int32Array; l*=2; x*=2;  break;
	}
	for ( var i=x ; i < x+l ; i++ )
	    arr[i] = p;
    }

    function check(loc) {
	if (!pop[loc])
	    return;
	var l = size[loc];
	var t = tag[loc];
	var x = pop[loc];
	var p;
	var arr;
	switch (t) {
	case 0: p = P & 0xFF; arr=a.Int8Array; break;
	case 1: p = P & 0xFFFF; arr=a.Int16Array; break;
	case 2: p = P; arr=a.Int32Array; break;
	case 3: p = P; arr=a.Int32Array; l*=2; x*=2;  break;
	}
	for ( var i=x ; i < x+l ; i++ ) {
	    try {
		assertEq(arr[i], p|0);
		arr[i] = 0;
	    }
	    catch (e) {
		print("At loc " + i + " (tag=" + t + "): " + arr[i].toString(16) + " " + p.toString(16));
		print(e.stack);
		throw e;
	    }
	}
    }

    function free(loc) {
	try {
	    if (pop[loc])
		frees[tag[loc]](pop[loc]);
	}
	catch (e) {
	    print("Fail: loc=" + loc + ", tag=" + tag[loc] + ", size=" + size[loc] + ", p=" + pop[loc]);
	    throw e;
	}
    }

    function nextRand() {
	return (X = (A * X + C) % M) & 0xFFFF;
    }

    /* Size is abstract and the number of bytes allocated depends on
       the allocator that is paired with a size. */
    function nextSize() {
	return sizes[nextRand() % sizes.length];
    }
}

for ( var i=1 ; i <= numWorkers ; i++ )
    evalInWorker(`
load("../src/alloc.js");
var numWorkers = ${numWorkers};
var numObjs = ${numObjs};
var numLive = ${numLive};
var workerID = ${i};
var sab2 = getSharedArrayBuffer();
${run_test.toSource()}
run_test();
`);

try {
    run_test();
} catch (e) {
    print(e.stack);
    throw e;
}

// Not really any easy predefined to join with the worker, should fix that.
alloc2._printBlockFree();

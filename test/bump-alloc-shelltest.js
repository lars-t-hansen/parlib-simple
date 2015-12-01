/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Sanity tests for the bump allocator in the JS shell.  This requires
// a JS shell built with the shared memory types.

load("../src/bump-alloc.js");
load("../src/barrier.js");

var nbytes = 1024;
var n = nbytes + BumpAlloc.NUMBYTES;
var padding = 32;
var sab = new SharedArrayBuffer(n + padding*2);
var base = padding;

// 32 bytes on each side is padding, we'll check at the end that they're untouched
var tmp = new Uint8Array(sab);
for ( var i=0 ; i < padding ; i++ ) {
    tmp[i] = 0xDE;
    tmp[tmp.length-1-i] = 0xBE;
}

BumpAlloc.initialize(sab, base, n);

var ba = new BumpAlloc(sab, base);
var ba2 = new BumpAlloc(sab, base);

// Sanity
assertEq(ba.Int8Array.length >= 1024, true);
assertEq(ba.Float64Array.length >= 128, true);

var bottom = ba.mark();

//////////////////////////////////////////////////////////////////////
// White-box tests.

// The heap limit is where we set it, plus page zero
assertEq(ba._limit, _BA_PAGEZEROSZ+nbytes);

// The first object is at the heap base.
var v = ba.allocInt32(1);
assertEq(v > 0, true);
assertEq(v, _BA_PAGEZEROSZ >>> 2);

// End white-box
//////////////////////////////////////////////////////////////////////

// Arrays alias, even across allocators
assertEq(ba.Int8Array.buffer, sab);
assertEq(ba.Int8Array.buffer, ba.Int32Array.buffer);
assertEq(ba.Int8Array.byteOffset, ba.Int32Array.byteOffset);
assertEq(ba2.Int8Array.byteOffset, ba.Int8Array.byteOffset);

// No padding
var first = ba.mark();
ba.allocInt32(10);
var next = ba.mark();
assertEq(first + 40, next);

// Mark/Release works as expected
ba.release(first);
assertEq(first, ba.mark());

// Allocating arrays works too
var a = ba.allocInt32Array(10);
assertEq(a.length, 10);

// No padding, and not overlapping
var b = ba.allocInt32Array(10);
assertEq(a.byteOffset + 40, b.byteOffset);

// Precise allocation semantics
ba.release(bottom);
for ( var i=0 ; i < nbytes/8 ; i++ )
    assertEq(ba.allocInt8(1) != 0, true);
assertEq(ba.allocInt8(1), 0);

ba.release(bottom);
for ( var i=0 ; i < nbytes/8 ; i++ )
    assertEq(ba.allocInt16(1) != 0, true);
assertEq(ba.allocInt16(1), 0);

ba.release(bottom);
for ( var i=0 ; i < nbytes/8 ; i++ )
    assertEq(ba.allocInt32(1) != 0, true);
assertEq(ba.allocInt32(1), 0);

ba.release(bottom);
for ( var i=0 ; i < nbytes/8 ; i++ )
    assertEq(ba.allocFloat32(1) != 0, true);
assertEq(ba.allocFloat32(1), 0);

ba.release(bottom);
for ( var i=0 ; i < nbytes/8 ; i++ )
    assertEq(ba.allocFloat64(1) != 0, true);
assertEq(ba.allocFloat64(1), 0);

// Scribble scribble
ba.release(bottom);
for ( var i=0 ; i < nbytes ; i++ )
    ba.Int32Array[i] = 0xCC;

// Make sure this is not allowed
ba.release(bottom);
ba.allocFloat64(1);
var exn = false;
try {
    ba.release(ba.mark() + 8);
}
catch (e) {
    exn = true;
}
assertEq(exn, true);

// Check that padding is untouched
for ( var i=0 ; i < padding ; i++ ) {
    assertEq(tmp[i], 0xDE);
    assertEq(tmp[tmp.length-1-i], 0xBE);
}

// Test contention / mutual exclusion.

var numWorkers = 2;

var size2 = 32768*(numWorkers+2); // For main + overhead
var sab2 = new SharedArrayBuffer(size2);
var base2 = 0;
BumpAlloc.initialize(sab2, base2, size2);
var ba2 = new BumpAlloc(sab2, base2);

var numIter = 10;		// Number of times to run the test
var numObjs = 1000;		// Number of objects to allocate every iteration
var objSize = 4;		// Words per object
var pattern = 0xA5A5A5A5|0;	// Poison pattern in main thread

var barrierIdx = ba2.allocInt32(Barrier.NUMINTS);
Barrier.initialize(ba2.Int32Array, barrierIdx, numWorkers+1);
var barrier = new Barrier(ba2.Int32Array, barrierIdx);

var mark = ba2.mark();

assertEq(mark % 8, 0);

function allocLoop(isMaster) {
    for ( var iter=0 ; iter < numIter ; iter++ ) {
	var as = [];
	for ( var i=0 ; i < numObjs ; i++ )
	    as.push(ba2.allocInt32(objSize));
	var ia = ba2.Int32Array;
	for ( var x of as )
	    for ( var i=0 ; i < objSize ; i++ ) {
		if (ia[x+i] != 0)
		    throw new Error("Wrong: on init");
		ia[x+i] = pattern;
	    }
	barrier.enter();
	for ( var x of as )
	    for ( var i=0 ; i < objSize ; i++ ) {
		if (ia[x+i] != pattern)
		    throw new Error("Wrong: on check");
		ia[x+i] = 0;
	    }
	barrier.enter();
	if (isMaster)
	    ba2.release(mark);
	barrier.enter();
    }
}

setSharedArrayBuffer(sab2);

var prog = `
load("../src/bump-alloc.js");
load("../src/barrier.js");
var sab2 = getSharedArrayBuffer();
var base2 = ${base2};
var ba2 = new BumpAlloc(sab2, base2);
var barrierIdx = ${barrierIdx};
var barrier = new Barrier(ba2.Int32Array, barrierIdx);
var numIter = ${numIter};
var numObjs = ${numObjs};
var objSize = ${objSize};
var pattern = 0xC3C3C3C3|0;
${allocLoop.toSource()}
allocLoop(false);
`

for ( var i=0 ; i < numWorkers ; i++ )
    evalInWorker(prog);

allocLoop(true);

print("Done");

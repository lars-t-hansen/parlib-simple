/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Sanity tests for the bump allocator in the JS shell.  This requires
// a JS shell built with the shared memory types.

load("../src/bump-alloc.js");

var nbytes = 1024;
var n = nbytes + BumpAlloc.NUMBYTES;
var padding = 32;
var sab = new SharedArrayBuffer(n + padding*2);
var base = padding;

// 32 bytes on each side is padding, we'll check at the end that they're untouched
var tmp = new SharedUint8Array(sab);
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

// Check that padding is untouched
for ( var i=0 ; i < padding ; i++ ) {
    assertEq(tmp[i], 0xDE);
    assertEq(tmp[tmp.length-1-i], 0xBE);
}

print("Done");

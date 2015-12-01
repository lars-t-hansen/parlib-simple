/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A basic library for shared-memory bump allocation.
//
// Usage:
//
// Initialize the shared memory for the allocators using
//   BumpAlloc.initialize().
//
// Create an allocator on shared memory with "new BumpAlloc()".
//   Allocators on the same memory can be created independently in
//   several agents and will be thread-safe.
//
// The allocator has accessors for TypedArrays of every type, eg,
//   m.Int32Array gets you the Int32Array mapped onto the memory.
//   These arrays all alias in all allocators and start at the same
//   byte offset in the shared memory (though they may overlap only
//   with part of the shared memory due to overhead and alignment).
//
// The allocator has methods for allocating ranges of elements within
//   the various typed arrays, eg, m.allocInt32(n) will allocate n
//   consecutive Int32 values.  In this case the value returned from
//   the allocator is an index within m.Int32Array.  If the value
//   returned is 0 then the allocation failed.
//
// The allocator has utility methods for allocating ranges of elements
//   within the shared memory as shared typed arrays, eg,
//   m.allocInt32Array(n) will bump-allocate memory for an n-element
//   Int32Array and return a new array object on those locations.  If
//   the value returned is null then the allocation failed.
//
// There is no facility for freeing individual locations or objects,
// nor is there any facility for adding more shared memory to the
// allocator.
//
// Allocation is linear in the shared heap and thread-safe.
//
// Use the "mark" method to obtain the current allocation pointer and
//   the "release" method to reset the allocation pointer to a
//   captured pointer.  The pointer is an integer.
//
// Any agent can allocate, mark, and reset.  Watch your step: marking
//   and resetting are racy operations that are best done by one agent
//   when it knows the other agents are quiescent.

//////////////////////////////////////////////////////////////////////

"use strict";

// PRIVATE values.

const _BA_METAINTS = 2;	        // Must be even.  Metadata + "page zero"
                                //   buffer to make 0 an illegal pointer
const _BA_TOP = 0;		// Allocation pointer index in metadata
const _BA_LIMIT = 1;		// Allocation limit index in metadata
const _BA_PAGEZEROSZ = 8;	// Number of bytes in unused space
const _BA_NUMBYTES = _BA_METAINTS*4 + _BA_PAGEZEROSZ;

// Create a memory manager on a piece of shared memory.
//
// "sab" is a SharedArrayBuffer.
// "byteOffset" is an offset within sab where the available memory starts.
//
// "sab" and "byteOffset" must be the same values as were passed to
// BumpAlloc.initialize(); a SharedArrayBuffer object in one agent
// that was transfered from another agent is considered "the same" as
// the one that was transfered.

function BumpAlloc(sab, byteOffset) {
    const adjustedByteOffset = (byteOffset + 7) & ~7;

    this._meta = new Int32Array(sab, adjustedByteOffset, _BA_METAINTS);

    const adjustedLimit = Atomics.load(this._meta, _BA_LIMIT);
    const baseOffset = adjustedByteOffset + _BA_METAINTS*4;
    const adjustedBytesAvail = adjustedLimit - baseOffset;

    this._int8Array = new Int8Array(sab, baseOffset, adjustedBytesAvail);
    this._uint8Array = new Uint8Array(sab, baseOffset, adjustedBytesAvail);
    this._int16Array = new Int16Array(sab, baseOffset, adjustedBytesAvail >> 1);
    this._uint16Array = new Uint16Array(sab, baseOffset, adjustedBytesAvail >> 1);
    this._int32Array = new Int32Array(sab, baseOffset, adjustedBytesAvail >> 2);
    this._uint32Array = new Uint32Array(sab, baseOffset, adjustedBytesAvail >> 2);
    this._float32Array = new Float32Array(sab, baseOffset, adjustedBytesAvail >> 2);
    this._float64Array = new Float64Array(sab, baseOffset, adjustedBytesAvail >> 3);

    this._limit = adjustedLimit - baseOffset;	// Cache this, it doesn't change
    this._sab = sab;
    this._baseOffset = baseOffset;
}

// The number of bytes needed for the allocator's internal data.

BumpAlloc.NUMBYTES = _BA_NUMBYTES;

// Initialize the shared memory that we'll map the allocator onto.
//
// "sab" is a SharedArrayBuffer.
// "byteOffset" is an offset within sab where the available memory starts.
//    This will be rounded up by the allocator to an eight-byte boundary.
// "bytesAvail" is the number of bytes in sab starting at byteOffset
//    available exclusively to the allocator.  This number will be rounded
//    down by the allocator to an eight-byte boundary.
//
// Sizing the storage for the allocator:
//  - The allocator will use a few bytes of shared memory for its own
//    data structures; the value BumpAlloc.NUMBYTES will provide the
//    number of bytes, properly rounded.
//  - There is no per-object overhead (headers or similar), but
//    allocations are rounded up to an eight-byte boundary.
//
// Thus, if the application precomputes the peak number of bytes
// needed for the its objects and factors in alignment and allocator
// overhead appropriately then it can pre-allocate a SharedArrayBuffer
// with tight bounds and count on it being large enough.
//
// After initialize() has returned the allocators can be constructed
// and used independently in different agents.

BumpAlloc.initialize =
    function (sab, byteOffset, bytesAvail) {
	const adjustedByteOffset = (byteOffset + 7) & ~7;
	const adjustedLimit = (byteOffset + bytesAvail) & ~7;
	const _meta = new Int32Array(sab, adjustedByteOffset, _BA_METAINTS);
	Atomics.store(_meta, _BA_TOP, _BA_PAGEZEROSZ);
	Atomics.store(_meta, _BA_LIMIT, adjustedLimit);
    };

// The BumpAlloc object has the following accessors:
//
//   Int8Array
//   Uint8Array
//   Int16Array
//   Uint16Array
//   Int32Array
//   Uint32Array
//   Float32Array
//   Float64Array
//
// The arrays returned from these all overlap completely, and they
// overlap across all agents.

Object.defineProperties(BumpAlloc.prototype,
			{ Int8Array: { get: function () { return this._int8Array; } },
			  Uint8Array: { get: function () { return this._uint8Array; } },
			  Int16Array: { get: function () { return this._int16Array; } },
			  Uint16Array: { get: function () { return this._uint16Array; } },
			  Int32Array: { get: function () { return this._int32Array; } },
			  Uint32Array: { get: function () { return this._uint32Array; } },
			  Float32Array: { get: function () { return this._float32Array; } },
			  Float64Array: { get: function () { return this._float64Array; } } });

// PRIVATE.  Returns an integer byte offset within the sab for nbytes
// of storage, aligned on an 8-byte boundary.  Returns 0 on allocation
// error.  Thread-safe.

BumpAlloc.prototype._allocBytes =
    function (nbytes) {
	const meta = this._meta;
	const limit = this._limit;
	nbytes = (nbytes + 7) & ~7;
	// There's an alternative protocol here that adds unconditionally and then checks
	// for overflow, and if there was overflow subtracts and returns zero.  It has
	// fewer atomic ops in the common case.  But that approach can trigger spurious
	// error returns in other threads.
	var x = Atomics.load(meta, _BA_TOP);
	do {
	    var p = x;
	    var newtop = p+nbytes;
	    if (newtop > limit)
		return 0;
	} while ((x = Atomics.compareExchange(meta, _BA_TOP, p, newtop)) != p);
	return p;
    };

// Allocators.  These will round the request up to eight bytes.  Each
// returns an index within the appropriately typed array, or 0 on
// allocation error (memory full).

BumpAlloc.prototype.allocInt8 =
    function (nelements) {
	return this._allocBytes(nelements);
    };

BumpAlloc.prototype.allocUint8 =
    BumpAlloc.prototype.allocInt8;

BumpAlloc.prototype.allocInt16 =
    function (nelements) {
	return this._allocBytes(nelements*2) >>> 1;
    };

BumpAlloc.prototype.allocUint16 =
    BumpAlloc.prototype.allocInt16;

BumpAlloc.prototype.allocInt32 =
    function (nelements) {
	return this._allocBytes(nelements*4) >>> 2;
    };

BumpAlloc.prototype.allocUint32 =
    BumpAlloc.prototype.allocInt32;

BumpAlloc.prototype.allocFloat32 =
    BumpAlloc.prototype.allocInt32;

BumpAlloc.prototype.allocFloat64 =
    function (nelements) {
	return this._allocBytes(nelements*8) >>> 3;
    };

// Convenient methods for allocating array data directly.  These
// return null on OOM and otherwise a TypedArray of the appropriate
// type.

BumpAlloc.prototype.allocInt8Array =
    function (nelements) {
	var p = this.allocInt8(nelements);
	if (!p)
	    return null;
	return new Int8Array(this._sab, this._baseOffset + p, nelements);
    };

BumpAlloc.prototype.allocUint8Array =
    function (nelements) {
	var p = this.allocUint8(nelements);
	if (!p)
	    return null;
	return new Uint8Array(this._sab, this._baseOffset + p, nelements);
    };

BumpAlloc.prototype.allocInt16Array =
    function (nelements) {
	var p = this.allocInt16(nelements);
	if (!p)
	    return null;
	return new Int16Array(this._sab, this._baseOffset + (p << 1), nelements);
    };

BumpAlloc.prototype.allocUint16Array =
    function (nelements) {
	var p = this.allocUint16(nelements);
	if (!p)
	    return null;
	return new Uint16Array(this._sab, this._baseOffset + (p << 1), nelements);
    };

BumpAlloc.prototype.allocInt32Array =
    function (nelements) {
	var p = this.allocInt32(nelements);
	if (!p)
	    return null;
	return new Int32Array(this._sab, this._baseOffset + (p << 2), nelements);
    };

BumpAlloc.prototype.allocUint32Array =
    function (nelements) {
	var p = this.allocUint32(nelements);
	if (!p)
	    return null;
	return new Uint32Array(this._sab, this.baseOffset + (p << 2), nelements);
    };

BumpAlloc.prototype.allocFloat32Array =
    function (nelements) {
	var p = this.allocFloat32(nelements);
	if (!p)
	    return null;
	return new Float32Array(this._sab, this.baseOffset + (p << 2), nelements);
    };

BumpAlloc.prototype.allocFloat64Array =
    function (nelements) {
	var p = this.allocFloat64(nelements);
	if (!p)
	    return null;
	return new Float64Array(this._sab, this.baseOffset + (p << 3), nelements);
    };

// Mark is a synchronization point.  The returned value is never 0.
// The returned value is always divisible by 8.

BumpAlloc.prototype.mark =
    function () {
	return Atomics.load(this._meta, _BA_TOP);
    };

// Release is a synchronization point.

BumpAlloc.prototype.release =
    function (p) {
	const meta = this._meta;
	if ((p|0) !== p || p < 0 || p > this._int8Array.length)
	    throw new Error("Invalid heap marker: " + p);
	var x = Atomics.load(meta, _BA_TOP, p);
	do {
	    var old = x;
	    if (p > old)
		throw new Error("Invalid heap marker (above current top): " + p);
	} while ((x = Atomics.compareExchange(meta, _BA_TOP, old, p)) != old);
    };

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A library for thread-safe shared-memory allocation and deallocation.
//
// Usage:
//
// Initialize the shared memory for the allocators using
//   SharedAlloc.initialize().
//
// Create an allocator on shared memory with "new SharedAlloc()".
//   Allocators on the same memory can be created independently in
//   several agents and will be thread-safe.
//
// The allocator has accessors for SharedTypedArrays of every type,
//   eg, m.Int32Array gets you the SharedInt32Array mapped onto the
//   memory.  These arrays all alias in all allocators and start at
//   the same byte offset in the shared memory (though they may
//   overlap only with part of the shared memory due to overhead and
//   alignment).
//
// The allocator has methods for allocating ranges of elements within
//   the various typed arrays, eg, m.allocInt32(n) will allocate n
//   consecutive Int32 values.  In this case the value returned from
//   the allocator is an index within m.Int32Array.  If the value
//   returned is 0 then the allocation failed.
//
// The allocator has utility methods for allocating ranges of elements
//   within the shared memory as shared typed arrays, eg,
//   m.allocInt32Array(n) will allocate memory for an n-element
//   SharedInt32Array and return a new array object on those
//   locations.  If the value returned is null then the allocation
//   failed.
//
// The allocator has methods for freeing objects allocated with the
//   allocator.  m.free(obj) will free the object if obj denotes
//   a value returned from n.alloc<Type>() or n.alloc<Type>Array()
//   for any n that is a SharedAlloc on the same memory as m.
//
// There is no facility for adding more shared memory to the
// allocator: what you give it initially is what it gets.

// Implementation:
// - A thread obtains smallish blocks for small-object allocations
//   and then carves small objects out of that; small objects are
//   placed onto thread-local free lists
// - Objects have a header and footer
// - Occasionally the local free lists are coalesced and entirely
//   free blocks are returned to the global block pool.  (Eg,
//   every time the set of local blocks has doubled in size, or
//   some number of large objects has been allocated, we can
//   perhaps check this sometimes, it can be signaled from the
//   global allocator to the local allocator by failing an
//   allocation with a special value.)
// - Large objects are allocated directly in the global block pool
// - There are global free lists for the global block pool

"use strict";

// PRIVATE values.

const _SA_NUMGLISTS = 8		// 4 8 16 32 64 128 256 xxx kilobytes
const _SA_NUMLLISTS = 8;	// 4 8 16 32 64 128 256 512 words

const _SA_BASE = 0;		// Allocation base index in metadata
const _SA_TOP = 1;		// Allocation pointer index in metadata
const _SA_LIMIT = 2;		// Allocation limit index in metadata
const _SA_UNUSED = 3;		// Unused
const _SA_GLIST0 = 4;		// First of 8 global free lists
const _SA_PAGEZEROSZ = 8;	// Number of bytes in unused space

const _SA_METAINTS = 12;        // Must be even.  Metadata + "page zero"
                                //   buffer to make 0 an illegal pointer

const _SA_BYTES_IN_BLOCK = 4096;
const _SA_BLOCK_SHIFT = 12;

const _SA_BLKNEXT = 0;		// "next" field of a block: byte address
const _SA_BLKSIZE = 1;          // "size" field of a block: number of 4K blocks

const _SA_OBJSIZE = 0;		// object fields
const _SA_OBJUNUSED = 1;	//   when inside
const _SA_OBJNEXT = 2;		//     the allocator

// Create a SharedAlloc on a piece of shared memory.
//
// "sab" is a SharedArrayBuffer.
// "byteOffset" is an offset within sab where the available memory starts.
//
// "sab" and "byteOffset" must be the same values as were passed to
// SharedAlloc.initialize(); a SharedArrayBuffer object in one agent
// that was transfered from another agent is considered "the same" as
// the one that was transfered.

function SharedAlloc(sab, byteOffset) {
    const adjustedByteOffset = (byteOffset + 7) & ~7;

    this._meta = new SharedInt32Array(sab, adjustedByteOffset, _SA_METAINTS);
    this._free = new Array(_SA_NUMLLISTS);  // FIXME: initialize to 0
    // FIXME: block budget, free counter
    const adjustedLimit = Atomics.load(this._meta, _SA_LIMIT);
    const baseOffset = adjustedByteOffset + _SA_METAINTS*4;
    const adjustedBytesAvail = adjustedLimit - baseOffset;

    this._int8Array = new SharedInt8Array(sab, baseOffset, adjustedBytesAvail);
    this._uint8Array = new SharedUint8Array(sab, baseOffset, adjustedBytesAvail);
    this._int16Array = new SharedInt16Array(sab, baseOffset, adjustedBytesAvail >> 1);
    this._uint16Array = new SharedUint16Array(sab, baseOffset, adjustedBytesAvail >> 1);
    this._int32Array = new SharedInt32Array(sab, baseOffset, adjustedBytesAvail >> 2);
    this._uint32Array = new SharedUint32Array(sab, baseOffset, adjustedBytesAvail >> 2);
    this._float32Array = new SharedFloat32Array(sab, baseOffset, adjustedBytesAvail >> 2);
    this._float64Array = new SharedFloat64Array(sab, baseOffset, adjustedBytesAvail >> 3);

    // FIXME: base
    this._limit = adjustedLimit - baseOffset;	// Cache this, it doesn't change
    this._sab = sab;
    this._baseOffset = baseOffset;
}

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
//
// As the allocator has storage needs of its own and there is a
// per-object header and other alignment restrictions, as well as
// intra-thread and inter-thread fragmentation, it is hard to give
// good guidance about heap sizing.  The allocator is probably most
// appropriate for heaps in the hundreds of KB and larger.
//
// After initialize() has returned the allocators can be constructed
// and used independently in different agents.

SharedAlloc.initialize =
    function (sab, byteOffset, bytesAvail) {
	const adjustedByteOffset = (byteOffset + 7) & ~7;
	const adjustedLimit = (byteOffset + bytesAvail) & ~7;
	const _meta = new SharedInt32Array(sab, adjustedByteOffset, _SA_METAINTS);
	Atomics.store(_meta, _SA_TOP, _SA_PAGEZEROSZ);
	Atomics.store(_meta, _SA_LIMIT, adjustedLimit);

	// FIXME: initialize the global free lists
    };

// The SharedAlloc object has the following accessors:
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

Object.defineProperties(SharedAlloc.prototype,
			{ Int8Array: { get: function () { return this._int8Array; } },
			  Uint8Array: { get: function () { return this._uint8Array; } },
			  Int16Array: { get: function () { return this._int16Array; } },
			  Uint16Array: { get: function () { return this._uint16Array; } },
			  Int32Array: { get: function () { return this._int32Array; } },
			  Uint32Array: { get: function () { return this._uint32Array; } },
			  Float32Array: { get: function () { return this._float32Array; } },
			  Float64Array: { get: function () { return this._float64Array; } } });


// BEGIN PRIVATE CODE.

// Overall design.
//
// There is a global block allocator.  A block is of fixed size
// (possibly 4KB), not necessarily aligned on such a size boundary.
// The block allocator maintains a set of size-segregated
// address-ordered eagerly-coalesced free lists of block ranges under
// control of a spinlock.
//
// There are local object allocators.  These maintain local
// size-segregated unordered free lists for small objects with
// occasional coalescing.  They allocate blocks in small increments
// from the block allocator and return blocks to it as they become
// free.  Small objects have an 8-byte header and the minimum size is
// 16 bytes.  Note local free lists can contain objects that are
// within blocks that were allocated by other allocators.
//
// Local allocators allocate and free larger objects (larger than some
// fraction of the block size) directly out of the block allocator.

function _ceilLog2(n) {
    var v = 0;
    while (n > 1) {
	if (n & 1)
	    n++;
	v++;
	n >>>= 1;
    }
    return v;
}

function _blockFreelistFor(numblocks) {
    return Math.min(_ceilLog2(numblocks), _SA_NUMGLISTS-1);
}

// TODO: Whether a spinlock is a good idea is open.  It depends on the
// cost of futexes, and on contention in the block allocator.

SharedAlloc.prototype._blockLock =
    function () {
	while (Atomics.compareExchange(this._meta, _SA_GLOCK, 0, -1) != 0)
	    ;
    };

SharedAlloc.prototype._blockUnlock =
    function () {
	Atomics.store(this._meta, _SA_GLOCK, 0);
    };

// Returns the byte address of a block, or 0.
//
// TODO: When this fails to allocate it should possibly return 0 on
// all threads once to force coalescing in each thread.

SharedAlloc.prototype._allocBlocks =
    function (numblocks) {
	const ia = this._int32Array;
	const meta = this._meta;
	const start = _blockFreelistFor(numblocks);

	this._blockLock();
	var ptr = 0;
	var size = 0;
	for ( var i=start ; i < _SA_NUMGLISTS ; i++ ) {
	    ptr = meta[_SA_GLIST0 + i];
	    if (ptr) {
		meta[_SA_GLIST0 + i] = ia[(ptr>>2) + _SA_BLKNEXT];
		size = ia[(ptr>>2) + _SA_BLKSIZE];
		break;
	    }
	}
	this._blockUnlock();

	if (size > numblocks)
	    this._freeBlocks(ptr + numblocks*_SA_BYTES_IN_BLOCK, size-numblocks);

	return ptr;
    };

SharedAlloc.prototype._freeBlocks =
    function (addr, numblocks) {
	const ia = this._int32Array;
	const meta = this._meta;
	if (addr == 0 || (addr & 4095))
	    throw new Error("Invalid block address");
	var again;
	do {
	    var listno = _blockFreelistFor(numblocks);

	    this._blockLock();
	    var l = meta[_SA_GLIST0 + listno];
	    var p = 0;
	    while (l && l > addr) {
		p = l;
		l = ia[(l>>2) + _SA_BLKNEXT];
	    }
	    again = false;
	    if (l) {
		var next = ia[(l>>2) + _SA_BLKNEXT];
		if (l + ia[(l>>2) + _SA_BLKSIZE]*_SA_BYTES_IN_BLOCK == addr) {
		    // Merge l and addr
		    if (p)
			ia[(p>>2) + _SA_BLKNEXT] = next;
		    else
			meta[_SA_GLIST0 + listno] = next;
		    addr = l;
		    numblocks *= 2;
		    again = true;
		}
		else if (addr + numblocks*_SA_BYTES_IN_BLOCK == next) {
		    // Merge addr and next
		    var nextnext = ia[(next>>2) + _SA_BLKNEXT];
		    ia[(l>>2) + _SA_BLKNEXT] = nextnext;
		    numblocks *= 2;
		    again = true;
		}
	    }
	    if (!again) {
		// insert addr after l or at the beginning
		ia[(addr>>2) + _SA_BLKNEXT] = next;
		ia[(addr>>2) + _SA_BLKSIZE] = numblocks;
		if (l)
		    ia[(l>>2) + _SA_BLKNEXT] = addr;
		else
		    meta[_SA_GLIST0 + listno] = addr;
	    }
	    this._blockUnlock();
	} while (again);
    };

// Returns an integer byte offset within the sab for nbytes of
// storage, aligned on an 8-byte boundary.  Returns 0 on allocation
// error.

function _objFreelistFor(nbytes) {
    return _ceilLog2(nbytes); // FIXME: Not quite
}

// Object layout with two-word object header:
//
//    Size
//    Unused
// p->First word
//    ...
//    Last word

SharedAlloc.prototype._allocBytes =
    function (nbytes) {
	const iab = this._int32Array;

	nbytes = ((nbytes + 15) & ~7); // 8 bytes for header

	if (nbytes < _SA_LARGE_LIMIT) {
	    for (;;) {
		var list = objFreelistFor(nbytes);
		var probe = this._freeLists[list];
		if (probe) {
		    // Header is already correct
		    this._freeLists[list] = ia[(probe>>2) + _SA_NEXT];
		    return probe+8;
		}

		for ( ; list < _SA_NUMLLISTS ; list++ ) {
		    var probe = this._freeLists[list];
		    if (probe) {
			// Allocate part, free the rest (remember to initialize header of freed part)
			// FIXME
			return probe+8;
		    }
		}

		if (this._blocksBudget == 0) {
		    this._coalesce();
		    continue;
		}

		if (!this._refill())
		    return 0;
	    }
	}
	else {
	    var numblocks = (nbytes + _SA_BYTES_IN_BLOCK - 1) >> _SA_BLOCK_SHIFT;
	    var b = this._allocBlocks(numblocks);
	    if (!b) {
		this._coalesce();
		b = this._allocBlocks(numblocks);
		if (!b)
		    return 0;
	    }
	    ia[(b>>2) + _SA_OBJSIZE] = numblocks * _SA_BYTES_IN_BLOCK;
	    return b+8;
	}
    };

// Allocate a block, add to free lists.  Return false on error.

SharedAlloc.prototype._refill =
    function () {
	var b = this._allocBlocks(1);
	if (!b) {
	    this._coalesce();
	    b = this._allocBlocks(1);
	    if (!b)
		return false;
	}
	var k = _SA_BYTES_IN_BLOCK / _SA_BYTES_IN_LARGEST_LLIST;
	for ( var i=k-1 ; i >= 0 ; i-- ) {
	    var p = b + i*_SA_BYTES_IN_LARGEST_LLIST;
	    ia[(p>>2) + _SA_NEXT] = this._freelists[_SA_NUMLLISTS-1];
	    this._freelists[_SA_NUMLLISTS-1] = p;
	}
	return true;
    };

SharedAlloc.prototype._freeBytes =
    function (p) {
	if ((p & 3) || p < this._base || p >= this._limit)
	    throw new Error("Not a valid pointer: " + p);

	p -= 8;

	const iab = this._int32Array;
	const size = iab[p + _SA_OBJSIZE];
	if (size < _SA_LARGE_LIMIT) {
	    var list = _ceilLog2(size);
	    ia[(p>>2) + _SA_NEXT] = this._freeLists[list];
	    this._freeLists[list] = p;
	    this._bytesFreed += size;
	    if (this._bytesFreed >= _SA_COALESCE_LIMIT)
		this._coalesce();
	}
	else
	    this._freeBlocks(p, size >> _SA_BLOCK_SHIFT);
    };

// Coalescing is tricky because it is unsynchronized and a free list
// can contain objects that belong to blocks that this allocator may
// not have allocated.  Coalescing may not write memory that may be
// read by other threads or read memory that may be written by other
// threads.
//
// In the worst case a page may have some free objects in one
// allocator and other free objects in another allocator and will
// never be returned.  This can be fixed by passing around lists of
// "unresolved" free objects after coalescing, but I'm ignoring the
// problem for now.
//
// The simplest way to coalesce may be if each object contains (in the
// second header word) the (constant) page index of the page it was
// allocated from; during coalescing we can then bucket free objects
// from pages and coalesce easily and with limited memory use (one
// array for the buckets and some auxiliary data).  We could avoid
// storing the page index if the block allocator would guarantee that
// blocks are allocated on block-aligned addresses.

SharedAlloc.prototype._coalesce =
    function () {
	// Implementme.  Not required for correctness per se, but
	// required for good memory usage.
	//
	// Resets the block budget and bytes freed counter.
    };

// END PRIVATE CODE.

// Allocators.  These will round the request up to eight bytes.  Each
// returns an index within the appropriately typed array, or 0 on
// allocation error (memory full).

SharedAlloc.prototype.allocInt8 =
    function (nelements) {
	return this._allocBytes(nelements);
    };

SharedAlloc.prototype.allocUint8 =
    SharedAlloc.prototype.allocInt8;

SharedAlloc.prototype.allocInt16 =
    function (nelements) {
	return this._allocBytes(nelements*2) >>> 1;
    };

SharedAlloc.prototype.allocUint16 =
    SharedAlloc.prototype.allocInt16;

SharedAlloc.prototype.allocInt32 =
    function (nelements) {
	return this._allocBytes(nelements*4) >>> 2;
    };

SharedAlloc.prototype.allocUint32 =
    SharedAlloc.prototype.allocInt32;

SharedAlloc.prototype.allocFloat32 =
    SharedAlloc.prototype.allocInt32;

SharedAlloc.prototype.allocFloat64 =
    function (nelements) {
	return this._allocBytes(nelements*8) >>> 3;
    };

// Convenient methods for allocating array data directly.  These
// return null on OOM and otherwise a SharedTypedArray of the
// appropriate type.

SharedAlloc.prototype.allocInt8Array =
    function (nelements) {
	var p = this.allocInt8(nelements);
	if (!p)
	    return null;
	return new SharedInt8Array(this._sab, this._baseOffset + p, nelements);
    };

SharedAlloc.prototype.allocUint8Array =
    function (nelements) {
	var p = this.allocUint8(nelements);
	if (!p)
	    return null;
	return new SharedUint8Array(this._sab, this._baseOffset + p, nelements);
    };

SharedAlloc.prototype.allocInt16Array =
    function (nelements) {
	var p = this.allocInt16(nelements);
	if (!p)
	    return null;
	return new SharedInt16Array(this._sab, this._baseOffset + (p << 1), nelements);
    };

SharedAlloc.prototype.allocUint16Array =
    function (nelements) {
	var p = this.allocUint16(nelements);
	if (!p)
	    return null;
	return new SharedUint16Array(this._sab, this._baseOffset + (p << 1), nelements);
    };

SharedAlloc.prototype.allocInt32Array =
    function (nelements) {
	var p = this.allocInt32(nelements);
	if (!p)
	    return null;
	return new SharedInt32Array(this._sab, this._baseOffset + (p << 2), nelements);
    };

SharedAlloc.prototype.allocUint32Array =
    function (nelements) {
	var p = this.allocUint32(nelements);
	if (!p)
	    return null;
	return new SharedUint32Array(this._sab, this.baseOffset + (p << 2), nelements);
    };

SharedAlloc.prototype.allocFloat32Array =
    function (nelements) {
	var p = this.allocFloat32(nelements);
	if (!p)
	    return null;
	return new SharedFloat32Array(this._sab, this.baseOffset + (p << 2), nelements);
    };

SharedAlloc.prototype.allocFloat64Array =
    function (nelements) {
	var p = this.allocFloat64(nelements);
	if (!p)
	    return null;
	return new SharedFloat64Array(this._sab, this.baseOffset + (p << 3), nelements);
    };

SharedAlloc.prototype.free =
    function (obj) {
	if (typeof obj === "number" && (obj|0) == obj)
	    _freeBytes(obj);
	if (obj === null)
	    return;
	if (typeof obj === "object" && obj.hasOwnProperty("__shared_alloc_base")) {
	    var p = obj.__shared_alloc_base;
	    obj.__shared_alloc_base = 0;
	    _freeBytes(p);
	}
	throw new Error("Object cannot be freed: " + obj);
    };

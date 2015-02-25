/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A library for thread-safe shared-memory memory management.
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
//   the various typed arrays, eg, m.alloc32(n) will allocate n
//   consecutive Int32/Uint32/Float32 values.  In this case the value
//   returned from the allocator is an index within m.Int32Array,
//   m.Uint32Array, and/or m.Float32Array.  If the value returned is 0
//   then the allocation failed.
//
// The allocator has utility methods for allocating ranges of elements
//   within the shared memory as shared typed arrays, eg,
//   m.allocInt32Array(n) will allocate memory for an n-element
//   SharedInt32Array and return a new array object on those
//   locations.  If the value returned is null then the allocation
//   failed.
//
// The allocator has methods for freeing memory allocated with the
//   allocator.  If we have SharedAlloc instances m and n on the same
//   memory area (in different workers) then eg m.free32(p) will free
//   the cells at p, which must have been obtained from some
//   n.alloc32() call.
//
//   The reason the deallocation is type-specific is that eg an Int32
//   index is indistinguishable to the deallocator from a Uint8 index;
//   the client must supply that information, there is no space for it
//   in the "pointer".
//
//   Memory underlying shared arrays can be deallocated with the
//   single method n.freeArray(obj).
//
// There is no facility for adding more shared memory to the
// allocator: what you give it initially is what it gets.

"use strict";

// PRIVATE VALUES.

const _SA_BLOCKSPEW = 1;	// Block alloc/dealloc
const _SA_MERGESPEW = 2;	// Block merge
const _SA_CHECKING = 4;		// Implied with all other flags too
const _SA_FAILSPEW = 8;		// Alloc failure

// Combination of the preceding values

const _SA_DEBUG = _SA_FAILSPEW;

// Global free lists.  These hold multiples of 4KB up to 256 as
// follows: 4 8 16 32 64 128 256, and then a list of 512KB and larger
// blocks.  The list for "n" KB holds objects of size from n to m-4
// where m is the size for the next higher list.

const _SA_NUMGLISTS = 8;

// Local free lists.  These hold multiples of 8 bytes from 16 to 120
// (exact object sizes in all lists), then multiples of 128 from 128
// up to 1024 (inexact object sizes in the sense that a list for "n"
// bytes holds objects of size from n to m-8 where "m" is the size for
// the next higher list).

const _SA_NUMXLISTS = 14;	// Number of exact lists
const _SA_NUMYLISTS = 8;	// Number of inexact lists
const _SA_NUMLLISTS = _SA_NUMXLISTS + _SA_NUMYLISTS;

const _SA_BYTES_PER_BLOCK = 4096;
const _SA_BLOCK_SHIFT = 12;
const _SA_BLOCK_BUDGET = 16;	// Initial budget
const _SA_BYTES_IN_LARGEST_LLIST = 1024;
const _SA_LARGE_LIMIT = _SA_BYTES_IN_LARGEST_LLIST+1;

// Indices in the metadata:
const _SA_GLIST0 = 0;		             // First of 8 global free lists
const _SA_GLOCK = _SA_GLIST0+_SA_NUMGLISTS;  // Global spinlock
const _SA_AVAIL = _SA_GLOCK + 1;

// METAINTS Must be even: size of the metadata area.
const _SA_METAINTS = (_SA_AVAIL + 2) & ~1;

// Heap layout
const _SA_PAGEZEROSZ = 8;	// Number of bytes in unused space

// Block layout
const _SA_BLKNEXT = 0;		// "next" field of a block: byte address
const _SA_BLKSIZE = 1;          // "size" field of a block: number of 4K blocks
const _SA_BLKMETA = 2;		// Index of highest block metadata word + 1

// Object layout
const _SA_OBJSIZE = 0;		// object fields
const _SA_OBJPOISON = 1;	//   when inside
const _SA_OBJNEXT = 2;		//     the allocator

// Misc values
const _SA_FREEPOISON = 0x5F6F7F8F;
const _SA_ALLOCPOISON = 0x7A7B7C7D;

// END PRIVATE VALUES.

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
    const bytesAvail = this._meta[_SA_AVAIL];
    const adjustedLimit = (byteOffset + bytesAvail) & ~7;
    const baseOffset = adjustedByteOffset + _SA_METAINTS*4;
    const adjustedBytesAvail = adjustedLimit - baseOffset;
    const bottom = _SA_PAGEZEROSZ;
    const blocks = (adjustedLimit - (baseOffset + bottom)) >> _SA_BLOCK_SHIFT;
    const limit = bottom + blocks*_SA_BYTES_PER_BLOCK;

    this._free = [];
    for ( var i=0 ; i < _SA_NUMLLISTS ; i++ )
	this._free.push(0);
    this._blockBudget = _SA_BLOCK_BUDGET;
    this._bytesFreed = 0;
    this._coalesceLimit = this._blockBudget * _SA_BYTES_PER_BLOCK;

    this._int8Array = new SharedInt8Array(sab, baseOffset, adjustedBytesAvail);
    this._uint8Array = new SharedUint8Array(sab, baseOffset, adjustedBytesAvail);
    this._int16Array = new SharedInt16Array(sab, baseOffset, adjustedBytesAvail >> 1);
    this._uint16Array = new SharedUint16Array(sab, baseOffset, adjustedBytesAvail >> 1);
    this._int32Array = new SharedInt32Array(sab, baseOffset, adjustedBytesAvail >> 2);
    this._uint32Array = new SharedUint32Array(sab, baseOffset, adjustedBytesAvail >> 2);
    this._float32Array = new SharedFloat32Array(sab, baseOffset, adjustedBytesAvail >> 2);
    this._float64Array = new SharedFloat64Array(sab, baseOffset, adjustedBytesAvail >> 3);

    this._bottom = bottom;
    this._limit = limit;
    this._baseOffset = baseOffset;
    this._sab = sab;
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

SharedAlloc.initialize = function (sab, byteOffset, bytesAvail) {
    const adjustedByteOffset = (byteOffset + 7) & ~7;
    const adjustedLimit = (byteOffset + bytesAvail) & ~7;
    const baseOffset = adjustedByteOffset + _SA_METAINTS*4;
    const bottom = _SA_PAGEZEROSZ;
    const blocks = (adjustedLimit - (baseOffset + bottom)) >> _SA_BLOCK_SHIFT;
    const limit = bottom + blocks*_SA_BYTES_PER_BLOCK;

    const _meta = new SharedInt32Array(sab, adjustedByteOffset, _SA_METAINTS);
    for ( var i=0 ; i < _SA_METAINTS ; i++ )
	_meta[i] = 0;
    _meta[_SA_AVAIL] = bytesAvail;

    var view = new SharedInt32Array(sab, (baseOffset + bottom), _SA_BLKMETA);
    view[_SA_BLKNEXT] = 0;
    view[_SA_BLKSIZE] = blocks;

    _meta[_SA_GLIST0 + _blockFreelistFor(blocks)] = bottom;
}

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

//DEBUG
SharedAlloc.prototype._printBlockFree = function (skipLock) {
    const ia = this._int32Array;
    const meta = this._meta;
    try {
	if (!skipLock)
	    this._blockLock();
	for ( var i=0 ; i < _SA_NUMGLISTS ; i++ ) {
	    var s = "";
	    for ( var l=meta[_SA_GLIST0+i] ; l != 0 ; l=ia[(l>>2) + _SA_BLKNEXT] )
		s += "[addr=" + l + " size=" + ia[(l>>2) + _SA_BLKSIZE] + "]  ";
	    if (s != "") {
		print("Block list " + i);
		print("  " + s);
	    }
	}
    }
    finally {
	if (!skipLock)
	    this._blockUnlock();
    }
}

const _SA_globalListSizes = [1, 2, 4, 8, 16, 32, 64, Number.POSITIVE_INFINITY];

const _SA_allocd = {};		// Not correct for cross-thread communication
//END DEBUG

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
    var list = Math.min(_ceilLog2(numblocks), _SA_NUMGLISTS-1);
    if (_SA_DEBUG) {
	assertEq(_SA_globalListSizes[list] >= numblocks, true);
	assertEq(list == _SA_globalListSizes.length-1 || numblocks < _SA_globalListSizes[list+1], true);
    }
    return list;
}

// TODO: Whether a spinlock is a good idea is open.  It depends on the
// cost of futexes, and on contention in the block allocator.

SharedAlloc.prototype._blockLock = function () {
    while (Atomics.compareExchange(this._meta, _SA_GLOCK, 0, -1) != 0)
	;
}

SharedAlloc.prototype._blockUnlock = function () {
    Atomics.store(this._meta, _SA_GLOCK, 0);
}

// Returns the byte address of a block, or 0.
//
// TODO: When this fails to allocate it should possibly return 0 on
// all threads once to force coalescing in each thread.

SharedAlloc.prototype._allocBlocks = function (numblocks) {
    const ia = this._int32Array;
    const meta = this._meta;
    const start = _blockFreelistFor(numblocks);

    this._blockLock();

    var ptr = 0;
    var size = 0;
    for ( var i=start ; i < _SA_NUMGLISTS && !ptr ; i++ ) {
	var probe = meta[_SA_GLIST0 + i];
	var prev = 0;
	while (probe && (size = ia[(probe>>2) + _SA_BLKSIZE]) < numblocks) {
	    prev = probe;
	    probe = ia[(probe>>2) + _SA_BLKNEXT];
	}
	if (probe) {
	    var next = ia[(probe>>2) + _SA_BLKNEXT];
	    if (prev)
		ia[(prev>>2) + _SA_BLKNEXT] = next;
	    else
		meta[_SA_GLIST0 + i] = next;
	    ptr = probe;
	}
    }

    // Free the rump while in the critical region in case we're
    // holding onto "the" large block and there's contention for
    // it.

    if (ptr && size > numblocks)
	this._freeBlocksLocked(ptr + numblocks*_SA_BYTES_PER_BLOCK, size-numblocks, true);

    this._blockUnlock();

    if (_SA_DEBUG) {
	if (ptr && _SA_allocd[ptr])
	    throw new Error("ERROR: Already allocated: " + ptr);
	_SA_allocd[ptr] = numblocks;
	if (_SA_DEBUG & _SA_BLOCKSPEW)
	    print("_allocBlocks returned " + ptr + " for n=" + numblocks);
	if (!ptr && (_SA_DEBUG & _SA_FAILSPEW)) {
	    print("\n\n_allocBlocks failed for n=" + numblocks + " with start=" + start);
	    this._printBlockFree();
	}
    }

    return ptr;
}
// The coalescing logic is really too primitive.  Consider a case
// where two free blocks of size 4 are separated by a block of size 2
// that then becomes freed.  Now we should merge to a block of size 10
// but that does not happen here.

SharedAlloc.prototype._freeBlocksLocked = function (addr, numblocks) {
    const ia = this._int32Array;
    const meta = this._meta;

    for (;;) {
	var listno = _blockFreelistFor(numblocks);

	var f = meta[_SA_GLIST0 + listno]; // following block or 0
	var p = 0;			       // preceding block or 0
	var pp = 0;			       // p's preceding block or 0
	while (f && f < addr) {
	    pp = p;
	    p = f;
	    f = ia[(f>>2) + _SA_BLKNEXT];
	}

	var withP = p && p + ia[(p>>2) + _SA_BLKSIZE]*_SA_BYTES_PER_BLOCK == addr;
	var withF = f && addr + numblocks*_SA_BYTES_PER_BLOCK == f;

	if (!(withP || withF)) {
	    // Insert here
	    if (p)
		ia[(p>>2) + _SA_BLKNEXT] = addr;
	    else
		meta[_SA_GLIST0 + listno] = addr;
	    ia[(addr>>2) + _SA_BLKNEXT] = f;
	    ia[(addr>>2) + _SA_BLKSIZE] = numblocks;
	    break;
	}

	if (withP) {
	    // Unlink p and merge
	    if (_SA_DEBUG & _SA_MERGESPEW)
		print("Merging with predecessor");
	    if (pp)
		ia[(pp>>2) + _SA_BLKNEXT] = f;
	    else
		meta[_SA_GLIST0 + listno] = f;
	    numblocks += ia[(p>>2) + _SA_BLKSIZE];
	    addr = p;
	    p = pp;
	}

	if (withF) {
	    // Unlink f and merge
	    if (_SA_DEBUG & _SA_MERGESPEW)
		print("Merging with successor");
	    var fnext = ia[(f>>2) + _SA_BLKNEXT];
	    if (p)
		ia[(p>>2) + _SA_BLKNEXT] = fnext;
	    else
		meta[_SA_GLIST0 + listno] = fnext;
	    numblocks += ia[(f>>2) + _SA_BLKSIZE];
	}
    }
}

SharedAlloc.prototype._freeBlocks = function (addr, numblocks, forSplitting) {
    const ia = this._int32Array;
    const meta = this._meta;

    if (_SA_DEBUG) {
	if (_SA_DEBUG & _SA_BLOCKSPEW)
	    print("_freeBlocks freeing " + addr + " for n=" + numblocks);
	if (!forSplitting && !_SA_allocd[addr])
	    throw new Error("ERROR: Block not allocated: " + addr + " for " + numblocks);
	delete _SA_allocd[addr];
    }

    this._blockLock();
    this._freeBlocksLocked(addr, numblocks)
    this._blockUnlock();
}

// DEBUG
SharedAlloc.prototype._printFree = function () {
    const ia = this._int32Array;
    for ( var i=0 ; i < _SA_NUMLLISTS ; i++ ) {
	var s = "";
	for ( var p = this._free[i] ; p != 0 ; p = ia[(p>>2) + _SA_OBJNEXT] )
	    s += "[addr=" + p + " size=" + ia[(p>>2) + _SA_OBJSIZE] + "]  ";
	if (s != "") {
	    print("Object list " + i);
	    print("  " + s);
	}
    }
}

const _freeListCheck =
    [ 16,  24,  32,  40,  48,  56,  64,  72,
      80,  88 , 96, 104, 112, 120, 128, 256,
     384, 512, 640, 768, 896, 1024];
// END DEBUG

function _objFreelistFor(nbytes) {
    var l = nbytes <= 128 ? (nbytes - 16) >> 3 : 13 + (nbytes >> 7);
    if (_SA_DEBUG) {
	assertEq(nbytes >= 16, true);
	assertEq(nbytes % 8, 0);
	assertEq(nbytes <= _SA_BYTES_IN_LARGEST_LLIST, true);
	assertEq(nbytes >= _freeListCheck[l], true);
	assertEq(nbytes == 1024 || nbytes < _freeListCheck[l+1], true);
    }
    return l;
}

// Returns an integer byte offset within the sab for nbytes of
// storage, aligned on an 8-byte boundary.  Returns 0 on allocation
// error.

SharedAlloc.prototype._allocBytes = function (nbytes) {
    const ia = this._int32Array;

    nbytes = ((nbytes + 15) & ~7); // 8 bytes for header

    if (nbytes < _SA_LARGE_LIMIT) {
	for (;;) {
	    var list = _objFreelistFor(nbytes);
	    if (_SA_DEBUG)
		assertEq(list < this._free.length, true);
	    if (list < _SA_NUMXLISTS && this._free[list]) {
		var probe = this._free[list];
		if (_SA_DEBUG) {
		    assertEq(ia[(probe>>2) + _SA_OBJPOISON], _SA_FREEPOISON);
		    assertEq(ia[(probe>>2) + _SA_OBJSIZE] >= nbytes, true);
		}
		this._free[list] = ia[(probe>>2) + _SA_OBJNEXT];
		ia[(probe>>2) + _SA_OBJPOISON] = _SA_ALLOCPOISON;
		return probe+8;
	    }

	    for ( ; list < _SA_NUMLLISTS ; list++ ) {
		var probe = this._free[list];
		if (probe) {
		    var size = ia[(probe>>2) + _SA_OBJSIZE];
		    if (size >= nbytes) {
			// Allocate part, free the rest
			// Suboptimal to put the rump back on the list as one block?
			this._free[list] = ia[(probe>>2) + _SA_OBJNEXT];
			if (_SA_DEBUG)
			    assertEq(ia[(probe>>2) + _SA_OBJPOISON], _SA_FREEPOISON);
			if (size - nbytes >= 16) {
			    // Split the object
			    var rest = probe + nbytes;
			    ia[(probe>>2) + _SA_OBJSIZE] = nbytes;
			    ia[(rest>>2) + _SA_OBJSIZE] = size - nbytes;
			    ia[(rest>>2) + _SA_OBJPOISON] = _SA_ALLOCPOISON;
			    this._freeBytes(rest+8); // Should be freeBytesInternal or something
			}
			ia[(probe>>2) + _SA_OBJPOISON] = _SA_ALLOCPOISON;
			return probe+8;
		    }
		}
	    }

	    if (!this._refill()) {
		if (_SA_DEBUG & _SA_FAILSPEW)
		    print("_allocBytes failed for n=" + numblocks);
		return 0;
	    }
	}
    }
    else {
	var numblocks = (nbytes + _SA_BYTES_PER_BLOCK - 1) >> _SA_BLOCK_SHIFT;
	var b = this._allocBlocks(numblocks);
	if (!b) {
	    this._coalesce();
	    b = this._allocBlocks(numblocks);
	    if (!b) {
		if (_SA_DEBUG & _SA_FAILSPEW)
		    print("_allocBytes failed for n=" + numblocks);
		return 0;
	    }
	}
	ia[(b>>2) + _SA_OBJSIZE] = numblocks * _SA_BYTES_PER_BLOCK;
	ia[(b>>2) + _SA_OBJPOISON] = _SA_ALLOCPOISON;
	return b+8;
    }
}

// Allocate a block, add to free lists.  Return false on error.

SharedAlloc.prototype._refill = function () {
    const ia = this._int32Array;
    if (this._blocksBudget == 0)
	this._coalesce();
    var b = this._allocBlocks(1);
    if (!b) {
	this._coalesce();
	b = this._allocBlocks(1);
	if (!b)
	    return false;
    }
    this._blocksBudget--;
    var k = _SA_BYTES_PER_BLOCK / _SA_BYTES_IN_LARGEST_LLIST;
    if (_SA_DEBUG)
	assertEq(k|0, k);
    for ( var i=k-1 ; i >= 0 ; i-- ) {
	var p = b + i*_SA_BYTES_IN_LARGEST_LLIST;
	ia[(p>>2) + _SA_OBJSIZE] = _SA_BYTES_IN_LARGEST_LLIST;
	ia[(p>>2) + _SA_OBJPOISON] = _SA_FREEPOISON;
	ia[(p>>2) + _SA_OBJNEXT] = this._free[_SA_NUMLLISTS-1];
	this._free[_SA_NUMLLISTS-1] = p;
    }
    return true;
}

SharedAlloc.prototype._freeBytes = function (p) {
    p -= 8;
    const ia = this._int32Array;
    if (_SA_DEBUG)
	assertEq(ia[(p>>2) + _SA_OBJPOISON], _SA_ALLOCPOISON);
    if ((p & 3) || p < this._bottom || p >= this._limit)
	throw new Error("Not a valid pointer: " + p);
    const size = ia[(p>>2) + _SA_OBJSIZE];
    if (size < _SA_LARGE_LIMIT) {
	var list = _objFreelistFor(size);
	ia[(p>>2) + _SA_OBJNEXT] = this._free[list];
	ia[(p>>2) + _SA_OBJPOISON] = _SA_FREEPOISON;
	this._free[list] = p;
	this._bytesFreed += size;
	if (this._bytesFreed >= this._coalesceLimit)
	    this._coalesce();
    }
    else
	this._freeBlocks(p, size >> _SA_BLOCK_SHIFT, false);
}

SharedAlloc.prototype._freeAt = function (p) {
    if (typeof p !== "number" || (p|0) !== p)
	throw new Error("Invalid address: " + p);
    if (p == 0)
	return;
    this._freeBytes(p);
}

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
// blocks are allocated on block-aligned addresses.  That would be
// nice in general, at the moment any 8-byte aligned 4KB region is a
// valid "block", which is not great.

SharedAlloc.prototype._coalesce = function () {
    // TODO: Implement this.  Not required for correctness per se,
    // but required for good memory usage.
    //
    // Resets the block budget and bytes freed counter, and maybe
    // the coalesce limit.
    this._blockBudget = _SA_BLOCK_BUDGET;
    this._freeCounter = 0;

    /* Loop over the free list.  For each free object, find a
       bucket for the object (the bucket must describe a bona fide
       block).  Insert the object in this bucket, combining with
       adjacent objects.  If we get 4KB in the bucket then free
       the block. At the end, move free objects from the buckets
       back to our free lists.

       Variation: at the end of the coalescing, either grab the
       global free lists and incorporate locally for use, or put
       our free objects back onto the global list.  (Coin toss.)
    */
}

// END PRIVATE CODE.

// Allocators.  These will round the request up to eight bytes.  Each
// returns an index within the appropriately typed array, or 0 on
// allocation error (memory full).

// TODO: Arguably, "alloc8", "alloc16", "alloc32", "alloc64" would be
// adequate, and ditto for "free".  (For the array allocator we still
// want the types.)

SharedAlloc.prototype.alloc8 = function (nelements) {
    return this._allocBytes(nelements);
}

SharedAlloc.prototype.alloc16 = function (nelements) {
    return this._allocBytes(nelements*2) >>> 1;
}

SharedAlloc.prototype.alloc32 = function (nelements) {
    return this._allocBytes(nelements*4) >>> 2;
}

SharedAlloc.prototype.alloc64 = function (nelements) {
    return this._allocBytes(nelements*8) >>> 3;
}

// Convenient methods for allocating array data directly.  These
// return null on OOM and otherwise a SharedTypedArray of the
// appropriate type.

SharedAlloc.prototype.allocInt8Array = function (nelements) {
    var p = this.alloc8(nelements);
    if (!p)
	return null;
    return new SharedInt8Array(this._sab, this._baseOffset + p, nelements);
}

SharedAlloc.prototype.allocUint8Array = function (nelements) {
    var p = this.alloc8(nelements);
    if (!p)
	return null;
    return new SharedUint8Array(this._sab, this._baseOffset + p, nelements);
}

SharedAlloc.prototype.allocInt16Array = function (nelements) {
    var p = this.alloc16(nelements);
    if (!p)
	return null;
    return new SharedInt16Array(this._sab, this._baseOffset + (p << 1), nelements);
}

SharedAlloc.prototype.allocUint16Array = function (nelements) {
    var p = this.alloc16(nelements);
    if (!p)
	return null;
    return new SharedUint16Array(this._sab, this._baseOffset + (p << 1), nelements);
}

SharedAlloc.prototype.allocInt32Array = function (nelements) {
    var p = this.alloc32(nelements);
    if (!p)
	return null;
    return new SharedInt32Array(this._sab, this._baseOffset + (p << 2), nelements);
}

SharedAlloc.prototype.allocUint32Array = function (nelements) {
    var p = this.alloc32(nelements);
    if (!p)
	return null;
    return new SharedUint32Array(this._sab, this.baseOffset + (p << 2), nelements);
}

SharedAlloc.prototype.allocFloat32Array = function (nelements) {
    var p = this.alloc32(nelements);
    if (!p)
	return null;
    return new SharedFloat32Array(this._sab, this.baseOffset + (p << 2), nelements);
}

SharedAlloc.prototype.allocFloat64Array = function (nelements) {
    var p = this.alloc64(nelements);
    if (!p)
	return null;
    return new SharedFloat64Array(this._sab, this.baseOffset + (p << 3), nelements);
}

SharedAlloc.prototype.free8 = function free8(p) {
    this._freeAt(p);
}

SharedAlloc.prototype.free16 = function free16(p) {
    this._freeAt(p*2);
}

SharedAlloc.prototype.free32 = function free32(p) {
    this._freeAt(p*4);
}

SharedAlloc.prototype.free64 = function free64(p) {
    this._freeAt(p*8);
}

SharedAlloc.prototype.freeArray = function (obj) {
    if (obj === null)
	return;
    if (typeof obj === "object" && obj.hasOwnProperty("__shared_alloc_base")) {
	var p = obj.__shared_alloc_base;
	obj.__shared_alloc_base = 0;
	if (p)
	    this._freeAt(p);
    }
    throw new Error("Object cannot be freed: " + obj);
};

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The ItemPool data type.
//
// An ItemPool is a fixed-size lock-free (circular) buffer that can
// hold variable-length sequences of integer data.  It is useful for
// communicating data from the main thread to workers.
//
// The master creates a MasterItemPool and the workers all create
// WorkerItemPools, on the same shared memory.
//
// API overview:
//
// m.put(values) inserts the item comprising "values", if possible,
//   but will not wait for space to become available.
//
// m.reset() resets the pool.
//
// w.take() removes an item if available, or returns null; it does
//   not wait for an item to become available.

// Some implementation details:
//
// - There is a distinguished shared location known as 'meta' that
//   contains three fields:
//       size(12) | index(12) | counter(8)
//   where counter is just to prevent ABA problems, and the other
//   two fields are the index and size of the first item.
//
// - If (meta >>> 8) is zero then there is no first item.
//
// - Otherwise we read the 'size' words of the item and the word following
//   the item, which will contain the meta-value for the next item (with a
//   counter value of zero), if any.  This trailing word is always there,
//   it is zero if there's no item following.  (Observe that the next item
//   does not need to be directly following, since the meta-word contains
//   its index.)  Once all are read, we attempt to replace the meta word
//   with the new meta word (with a new counter).
//
// - Reading is circular in the buffer.
//
// - Appending to an empty queue means updating first the queue, then
//   the metaword; this is not racy (in writing the item's words)
//   because there is one master.  (But may be fixable anyway because we
//   need to have an insertion pointer and that might as well be stored in
//   the shared memory.)
//
// - Appending to a nonempty queue means updating just the queue.
//
// - The "insert" pointer points to the footer word of the last element in
//   memory.  That footer will always be zero, of course.  To insert
//   an element, place words after it, then update that footer word.
//   Then check the meta: if it is zero, update it to point to the newly
//   inserted element.

function MasterItemPool(iab, ibase, qbase, qsize) {
    this.iab = iab;
    this.ibase = ibase;
    this.qbase = qbase;
    this.qsize = qsize;

    iab[ibase] = 0;       // extract
    iab[ibase+1] = qbase; // insert
    iab[ibase+2] = qbase; // qbase
    iab[ibase+3] = qsize; // qsize
    iab[qbase] = 0;	  // footer @ insert
}

// Layout:
//  ibase     "extract" - distinguished word with front element
//  ibase+1   "insert"  - footer in the buffer after the tail element
//  ibase+2   qbase     - constant - buffer offset for queue start
//  ibase+3   qsize     - constant - buffer offset for queue element count
//
// Invariants:
//  The queue is empty if the size field of extract is zero

MasterItemPool.NUMINTS = 4;

// This returns true if the element was inserted, false if the buffer
// was full.

MasterItemPool.prototype.put =
    function (values) {
	if (values.length == 0)
	    throw new Error("Zero-length items are not allowed");
	if (values.length > 4095)
	    throw new Error("Items longer than 4095 elements are not allowed");
	var iab = this.iab;
	var extractIdx = this.ibase;

	var meta = Atomics.load(ibase, metaIdx);

    };


MasterItemPool.prototype.reset =
    function () {
	var iab = this.iab;
	var ibase = this.ibase;
	var extractIdx = ibase;
	var insertIdx = ibase+1;
	var newExtract = 0;

	// First drain the buffer by moving the extract pointer up to
	// the insert pointer; this will get consumers out of the way.
	do {
	    var extract = Atomics.load(iab, extractIdx);
	    var insertLoc = Atomics.load(iab, insertIdx);
	    if ((extract >>> 20) == 0)
		return null;
	    var cnt = extract & 0xFF;
	    newExtract = (insertLoc << 8) | ((cnt + 1) & 255);
	} while (Atomics.compareExchange(iab, extractIdx, extract, newExtract) != extract);

	// Then reset the pointers.
	Atomics.store(iab, this.qbase, 0); // Footer @ 0
	Atomics.store(iab, extractIdx, 0); // Extract @ 0
    };

function WorkerItemPool(iab, ibase) {
    this.iab = iab;
    this.ibase = ibase;
    this.qbase = iab[ibase+2];
    this.qsize = iab[ibase+3];
}

// This returns null if extraction is not possible, otherwise
// a fresh Array of the values extracted.

WorkerItemPool.prototype.take =
    function () {
	var iab = this.iab;
	var ibase = this.ibase;
	var qbase = this.qbase;
	var qsize = this.qsize;

	var extractIdx = ibase;

	var items = [];
	var iloc;
	var newExtract = 0;
	do {
	    iloc = 0;
	    var extract = Atomics.load(iab, extractIdx);
	    if ((extract >>> 20) == 0)
		return null;
	    var cnt = extract & 0xFF;
	    var idx = (extract >>> 8) & 0xFFF;
	    var size = extract >>> 20;
	    for ( var i=0 ; i < size ; i++ ) {
		items[iloc++] = iab[qbase+idx];
		idx = (idx+1) % qsize;
	    }
	    newExtract = iab[qbase+idx] | ((cnt+1) & 255);
	} while (Atomics.compareExchange(iab, extractIdx, extract, newExtract) != extract);
	items.length = iloc;
	return items;
    };

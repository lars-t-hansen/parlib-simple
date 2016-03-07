/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// A polyfill of futexes on top of synchronics.
//
// The client program must do a little setup before using these futexes:
//
//  - Allocate, initialize, and distribute a shared memory chunk for
//    the futex system to use, see Futex.initMemory() and Futex.setup().
//  - Tag every SAB that will be used with futexes with a reliable
//    identifier, see Futex.tagBuffer().
//
// After that, just call Futex.wait() and Futex.wake() in the normal way.
//
// TODO:
//
//  - It's perhaps desirable to have a faster data structure for the
//    waiters than a single linked list, to make the critical region
//    smaller during futexWake.  A trivial fix is one list per SAB,
//    that's what the futex implementation in Firefox uses (because it
//    manages waiters globally and not just per-tab, as here).  Better
//    still might be a table keyed on the (G,addr) pair: hash table,
//    heap, quadtree.  It may make a difference if there frequently
//    are many waiters *and* wait/wake frequency is high.  That said:
//    since agents (workers) are expensive it's likely there will be
//    few of them.  So who knows.

// List nodes - field offsets.

const _FUL_next = 0;		             // "Next" pointer
const _FUL_prev = 1;		             // "Prev" pointer

const _FUL_INTS = 2;

// Wait info nodes - field offsets.

const _FUW_wait = 0;		             // Synchronics signal and wait on this loc
const _FUW_G = 1;			     // Node ID: the address-free identifier "G"
const _FUW_addr = 2;		             // Node ID: the byte offset
const _FUW_node_OFFS = 3;		     // In-line List node
const _FUW_next = _FUW_node_OFFS + _FUL_next;
const _FUW_prev = _FUW_node_OFFS + _FUL_prev;

const _FUW_INTS = _FUW_node_OFFS + _FUL_INTS;

// Global data - absolute offsets within the working heap.

const _FU_lock = 0;		             // Lock word
const _FU_node_OFFS = 1;		     // In-line List node (header)
const _FU_first = _FU_node_OFFS + _FUL_next; //   First element in doubly-linked circular list
const _FU_last = _FU_node_OFFS + _FUL_prev;  //   Second element in doubly-linked circular list
const _FU_alloc = _FU_node_OFFS + _FUL_INTS; // Allocation pointer

const _FU_INTS = _FU_alloc + 1;


// Futex.initMemory()
//   Initialize the Futex's working memory (in allocating agent)
//
// Futex.setup()
//   Provide the futex system with working memory (in each agent)
//
// Futex.tagBuffer()
//   Provide a SharedArrayBuffer with an integer tag (in each agent)
//
// Futex.wait()
//   Compatible with Atomics.futexWait()
//
// Futex.wake()
//   Compatible with Atomics.futexWake()
//
// Futex.wakeOrRequeue()
//   Compatible with Atomics.futexWakeOrRequeue()
//
// Futex.OK, Futex.NOTEQUAL, Futex.TIMEDOUT
//   Compatible with Atomics.OK, Atomics.NOTEQUAL, Atomics.TIMEDOUT
//
// Note the methods will reference their "this" object, so if you
// extract the methods to store them elsewhere make sure to bind them
// to the Futex object.

var Futex =
{
    // The Futex system reserves this many bytes for its workspace.
    //
    // Really this depends on the number of agents, we need one _FUW
    // node per agent, plus some overhead for globals.  A _FUW is
    // currently 20 bytes, so 4KB is enough for about 200 agents,
    // which is more than we'll encounter in practice.

    BYTE_SIZE: 4096,

    // "sab" and "offset" are as in the call to setup().
    //
    // Call this in the agent that allocates the sab.  It MUST return
    // before you can call setup() in any agent.

    initMemory: function (sab, offset) {
	let _limit = this.BYTE_SIZE/4;
	let _ia = new Int32Array(sab, offset, _limit);
	Atomics.store(_ia, _FU_lock, 0);
	Atomics.store(_ia, _FU_first, _FU_node_OFFS);
	Atomics.store(_ia, _FU_last, _FU_node_OFFS);
	Atomics.store(_ia, _FU_alloc, _FU_INTS);
    },

    // "sab" is any SharedArrayBuffer.
    // "offset" is a byte offset in "sab", divisible by 4.
    //
    // The futex system will use memory in "sab" from "offset" through
    // "offset"+Futex.BYTE_SIZE-1, inclusive.

    setup: function (sab, offset) {
	let _limit = this.BYTE_SIZE/4;
	let _ia = new Int32Array(sab, offset, _limit);
	this._ia = _ia;
	this._limit = _limit;
	this._lock();
	this._waiter = this._allocNode();
	this._unlock();
	if (!this._waiter)
	    throw new Error("Out of futex memory");
    },

    // "sab" is a user SharedArrayBuffer.
    // "tag" is a nonnegative int32.
    //
    // Tag the buffer with with the tag, for later internal use.  A
    // private property will be added to the buffer.
    //
    // Constraints:
    //
    // - If two SharedArrayBuffer objects reference the same memory
    //   then those two objects MUST have the same tag.  That's true
    //   whether the two objects are in the same agent or different
    //   agents.  Note, they can be in the same agent if a SAB was
    //   transfered to another agent and back again.
    //
    // - If two SharedArrayBuffer objects do not reference the same
    //   memory then they MUST NOT have the same tag.

    tagBuffer: function (sab, tag_) {
	let tag = tag_|0;
	if (!(sab instanceof SharedArrayBuffer))
	    throw new Error("Not a SharedArrayBuffer: " + sab);
	if (tag != tag_ || tag < 0)
	    throw new Error("Bad tag: " + tag);
	if (sab.hasOwnProperty(this._G) && sab[this._G] != tag)
	    throw new Error("SharedArrayBuffer has already been tagged with a different tag");
	sab[this._G] = tag;
    },

    // "mem" is some Int32Array on shared memory.
    // "loc" is a valid location within "mem".
    // "value" is the value we want to be in that location before blocking.
    // "timeout" is, if not undefined, the millisecond timeout.
    //
    // Returns Futex.OK, Futex.NOTEQUAL, or Futex.TIMEDOUT.

    wait: function (mem, loc_, value_, timeout) {
	let loc = loc_|0;
	let value = value_|0;
	let G = this._identifier(mem.buffer);
	let addr = mem.byteOffset + loc*4;
	let ia = this._ia;
	let waiter = this._waiter;

	this._lock();
	if (mem[loc] != value) {
	    this._unlock();
	    return this.NOTEQUAL;
	}
	ia[waiter + _FUW_G] = G;
	ia[waiter + _FUW_addr] = addr;
	ia[waiter + _FUW_wait] = 0;
	{
	    let node = waiter + _FUW_node_OFFS;
	    let last = ia[_FU_last];
	    ia[node + _FUL_prev] = last;
	    ia[node + _FUL_next] = _FU_node_OFFS;
	    ia[_FU_last] = node;
	    ia[last + _FUL_next] = node;
	}
	this._unlock();

	let r = this.OK;
	Atomics.expectUpdate(ia, waiter + _FUW_wait, 0, timeout);
	if (Atomics.load(ia, waiter + _FUW_wait) == 0)
	    r = this.TIMEDOUT;

	this._lock();
	{
	    let node = waiter + _FUW_node_OFFS;
	    let prev = ia[node + _FUL_prev];
	    let next = ia[node + _FUL_next];
	    ia[next + _FUL_prev] = prev;
	    ia[prev + _FUL_next] = next;
	}
	this._unlock();

	return r;
    },

    // "mem" is some Int32Array on shared memory.
    // "loc" is a valid location within "mem".
    // "count" is the maximum number of waiters we want to wake.
    //
    // Returns the number of waiters woken.

    wake: function (mem, loc_, count_) {
	let loc = loc_|0;
	let count = count_ === undefined ? 0x7FFFFFFF : Math.max(0, count_);
	let G = this._identifier(mem.buffer);
	let addr = mem.byteOffset + loc*4;
	let ia = this._ia;
	let woken = 0;

	this._lock();
	for ( let node = ia[_FU_first] ; node != _FU_node_OFFS && count > 0 ; node = ia[node + _FUL_next] ) {
	    let waiter = node - _FUW_node_OFFS;
	    if (ia[waiter + _FUW_G] == G && ia[waiter + _FUW_addr] == addr) {
		if (ia[waiter + _FUW_wait] == 0) {
		    Atomics.storeNotify(ia, waiter + _FUW_wait, 1);
		    count--;
		    woken++;
		}
	    }
	}
	this._unlock();

	return woken;
    },

    // "mem" is some Int32Array on shared memory.
    // "loc1" and "loc2" are valid locations within "mem".
    // "count" is the maximum number of waiters we want to wake.
    // "value" is the value we want to be in that location before requeueing.
    //
    // Returns the number of waiters woken.

    wakeOrRequeue: function (ia, loc1, count, loc2, value) {
	// FIXME: implement wakeOrRequeue.  Nobody uses this, so far.
	throw new Error("Futex.wakeOrRequeue is not implemented");
    },

    OK:        0,
    NOTEQUAL: -1,
    TIMEDOUT: -2,

    _ia: null,			// Working memory: an Int32Array

    _waiter: 0,			// Offset of "waiter" node for this agent

    _G: Symbol("address_free_id"),

    _identifier: function (sab) {
	// Lock not held, and not needed
	if (!sab.hasOwnProperty(this._G))
	    throw new Error("SharedArrayBuffer has not been tagged");
	return sab[this._G];
    },

    _lock: function () {
	while (Atomics.compareExchange(this._ia, _FU_lock, 0, 1) == 1)
	    Atomics.expect(this._ia, _FU_lock, 0);
    },

    _unlock: function () {
	Atomics.storeNotify(this._ia, _FU_lock, 0, true);
    },

    _allocNode: function () {
	// Lock held
	let _ia = this._ia;
	let node = _ia[_FU_alloc];
	if (node + _FUW_INTS >= this._limit)
	    return 0;
	_ia[_FU_alloc] = node + _FUW_INTS;
	return node;
    },
}

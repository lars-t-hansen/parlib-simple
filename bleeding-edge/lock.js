// Lock and condition variable built on synchronics.
// Goal: an efficient wake() on Cond that wakes only one waiter.
//
// The API is not quite compatible with ../src/lock.js.

"use strict";

// Rough design:
//
//  - We reify agents; there is an Agent representation in shared memory
//  - When an agent waits, it waits on a word in its own representation
//  - While an agent waits, it puts itself on a list of waiting agents
//    in the lock or cond structure.
//  - The waking agent can then pick as many elements off that list as
//    it wants to and notify them individually.
//  - There is a single Int32Array that is used for all coordination
//    and metadata: agents, locks, and conds are all in the same ia.
//    This restriction is probably somewhat fundamental, although it
//    is possible that it would be sufficient for all locks and conds
//    to be in a common array and all agents to be in a (different) common
//    array.
//  - The single Int32Array is stored in the global _ia always.
//  - The current agent's address in _ia is stored in the global _self always.

////////////////////////////////////////////////////////////
//
// Basis data structures: spinlocks and lists in shared memory

// Spinlocks always require one word, which must be zero for unlocked,
// and should start out zero.

var Spinlock_INTS = 1;

var Spinlock = {
    lock: function(ia, loc) {
	while (Atomics.compareExchange(ia, loc, 0, 1) == 1)
	    Atomics.expect(ia, loc, 0);
    },

    unlock: function(ia, loc) {
	Atomics.storeNotify(ia, loc, 0);
    }
};

// Lists and nodes.  A List is a thread-unsafe data structure.  A Node
// is a thing used for things linked onto the list.  Things that want
// to be on a list embed a Node.

var Node_prev = 0;			     // Previous node in list
var Node_next = 1;			     // Next node in list
var Node_INTS = 2;

var List_node_OFFS = 0;			     // Offset of Node in the List
var List_prev = List_node_OFFS + Node_prev;  // Embedded
var List_next = List_node_OFFS + Node_next;  //   header node
var List_INTS = 2;

var List = {
    // Initialize the list structure.
    //
    // "list" is an offset in ia.

    initialize: function (ia, list) {
	ia[list + List_next] = list + List_node_OFFS;
	ia[list + List_prev] = list + List_node_OFFS;
    },

    // Add the node to the end of the list.
    //
    // "list" and "node" are offsets in ia.

    addLast: function (ia, list, node) {
	let next = list + List_node_OFFS;
	let prev = ia[list + List_prev];
	ia[node + Node_next] = next;
	ia[node + Node_prev] = prev;
	ia[next + Node_prev] = node;
	ia[prev + Node_next] = node;
    },

    // Remove the node from the list, whatever its position.
    //
    // "list" and "node" are offsets in ia.

    remove: function (ia, list, node) {
	let prev = ia[node + Node_prev];
	let next = ia[node + Node_next];
	ia[prev + Node_next] = next;
	ia[next + Node_prev] = prev;
    },

    // Remove the first agent from the list and return it,
    // or 0 if the list is empty.
    //
    // "list" is an offset in ia.

    removeFirst: function (ia, list) {
	let first = ia[list + List_next];
	if (first == list + List_node_OFFS)
	    first = 0;
	else {
	    let next = ia[first + Node_next];
	    ia[next + Node_prev] = list + List_node_OFFS;
	    ia[list + List_next] = next;
	}
	return first;
    }
};


////////////////////////////////////////////////////////////
//
// Agents

// Every agent has a representation in shared memory of itself.  This
// is a number of integers that holds agent-specific state.

var _ia = null;			// The shared coordination array
var _self = null;		// The current agent's base in _ia

function Agent() {} 		// Not very interesting at this point

// Call Agent.setup first, when initializing the agent.
//
// "ia" is the shared coordination Int32Array.
// "base" is the int32 offset of the local Agent's data structure
//   within that array.
// "id" is the local Agent's unique ID (positive integer, the
//   main thread's ID is known to be "1")

Agent.setup = function(ia, base, id) {
    _ia = ia;
    _self = base;
    ia[base + Agent_id] = id;
}

// The representation of the current agent

Agent.self = new Agent();

// Return the id of the agent

Agent.prototype.id = function () {
    return _ia[_self + Agent_id];
}

// Agent layout.

const Agent_id = 0;
const Agent_wait = 1;
const Agent_node_OFFS = 2;
const Agent_INTS = 2 + Node_INTS;
const Agent_BYTES = Agent_INTS * 4;


////////////////////////////////////////////////////////////
//
// Locks
//
// This is a almost obviously correct implementation, using a spinlock
// to guard the lock's internal data structures.  The fast-path for
// acquiring the spinlock is one CAS, which is fine.  But we also need
// an atomic store to release the spinlock, even in the uncontended
// case.
//
// The lock holds a list of agents waiting on the lock, if it is
// contended.  Unlock wakes only the first waiter on that list.  The
// list is ordered.  There is no extra cost to making it fair given
// that we've paid for the spinlock.

// Lock layout.

const Lock_state = 0;		// 0=unlocked, 1=locked but not contended, 2 or more=contended
const Lock_spin = 1;		// Spinlock for the lock
const Lock_list_OFFS = 2;	// Embedded list
const Lock_INTS = 2 + List_INTS;
const Lock_BYTES = Lock_INTS * 4;

function Lock(base) {
    this.base = base;
}

Lock.initialize = function (ia, lock) {
    ia[lock + Lock_state] = 0;
    ia[lock + Lock_spin] = 0;
    List.initialize(ia, lock + Lock_list_OFFS);
}

Lock.prototype.lock = function () {
    var lock = this.base;

    Spinlock.lock(_ia, lock + Lock_spin);

    if (++_ia[lock + Lock_state] == 1) {
     	Spinlock.unlock(_ia, lock + Lock_spin);
     	return;
    }

    List.addLast(_ia, this.base + Lock_list_OFFS, _self + Agent_node_OFFS);
    _ia[_self + Agent_wait] = 0;

    Spinlock.unlock(_ia, lock + Lock_spin);

    Atomics.expectUpdate(_ia, _self + Agent_wait, 0);
}

Lock.prototype.tryLock = function () {
    var lock = this.base;

    Spinlock.lock(_ia, lock + Lock_spin);

    var ret = false;
    if (_ia[lock + Lock_state] == 0) {
	_ia[lock + Lock_state]++;
	ret = true;
    }

    Spinlock.unlock(_ia, lock + Lock_spin);
    return ret;
}

Lock.prototype.unlock = function () {
    var lock = this.base;

    Spinlock.lock(_ia, lock + Lock_spin);

    if (--_ia[lock + Lock_state] == 0) {
	Spinlock.unlock(_ia, lock + Lock_spin);
	return;
    }

    let node = List.removeFirst(_ia, lock + Lock_list_OFFS);
    if (!node)
	throw new Error("NO NODE!!");

    let agent = node - Agent_node_OFFS;
    Atomics.storeNotify(_ia, agent + Agent_wait, 1);

    Spinlock.unlock(_ia, lock + Lock_spin);
}

Lock.prototype.toString = function () {
    return "Lock:{base:" + this.base +"}";
}

////////////////////////////////////////////////////////////
//
// Condition variables
//
// The condition variable holds an ordered list of agents blocked on
// the condition variable.  Since the lock is held when wait and wake
// are called, we can use the lock to protect the condvar's internal
// state.

// Condvar layout.

const Cond_spin = 0;		// 0=unlocked, 1=locked but not contended, 2 or more=contended
const Cond_list_OFFS = 1;
const Cond_INTS = 1 + List_INTS;
const Cond_BYTES = Cond_INTS * 4;

function Cond(base, lock) {
    this.base = base;
    this.lock = lock;
}

Cond.initialize = function (ia, cond) {
    ia[cond + Cond_spin] = 0;
    List.initialize(ia, cond + Cond_list_OFFS);
}

// Assert: the caller holds this.lock.

Cond.prototype.wait = function () {
    let cond = this.base;
    List.addLast(_ia, cond + Cond_list_OFFS, _self + Agent_node_OFFS);
    _ia[_self + Agent_wait] = 0;
    this.lock.unlock();
    Atomics.expectUpdate(_ia, _self + Agent_wait, 0);
    this.lock.lock();
}

// Assert: the caller holds this.lock.

Cond.prototype.wake = function () {
    let cond = this.base;
    let node = List.removeFirst(_ia, cond + Cond_list_OFFS);
    if (!node)
	return;
    let agent = node - Agent_node_OFFS;
    Atomics.notify(_iab, _self + Agent_wait, 1);
}

// Assert: the caller holds this.lock.

Cond.prototype.wakeAll = function () {
    let cond = this.base;
    for (;;) {
	// We hold the lock, so no new nodes will appear on the list
	// while we're traversing it.
	let node = List.removeFirst(_ia, cond + Cond_list_OFFS);
	if (!node)
	    return;
	let agent = node - Agent_node_OFFS;
	Atomics.notify(_iab, _self + Agent_wait, 1);
    }
}

Cond.prototype.toString = function () {
    return "Cond:{base:" + this.base +"}";
}

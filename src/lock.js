/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Simple, standalone lock and condition variable abstractions.
// 2015-01-13 / lhansen@mozilla.com

//////////////////////////////////////////////////////////////////////
//
// Locks.
//
// Locks are JS objects that use some shared memory for private data.
// The number of shared int32 locations needed is given by
// Lock.NUMINTS.  The shared memory for a lock should be initialized
// once by calling Lock.initialize() on the memory, before
// constructing the first Lock object in any agent.
//
//
// Implementation note:
// Lock code taken from http://www.akkadia.org/drepper/futex.pdf.
// Lock states:
//   0: unlocked
//   1: locked with no waiters
//   2: locked with possible waiters
//
// This could be built on Synchronic instead, but this code predates
// the Synchronic facility.

"use strict";

// Create a lock object.
//
// 'iab' must be a Int32Array mapping shared memory.
// 'ibase' must be a valid index in iab, the first of Lock.NUMINTS reserved for the lock.
//
// iab and ibase will be exposed on Lock.
function Lock(iab, ibase) {
    if (!(iab instanceof Int32Array && ibase|0 == ibase && ibase >= 0 && ibase+Lock.NUMINTS <= iab.length))
	throw new Error("Bad arguments to Lock constructor: " + iab + " " + ibase);
    this.iab = iab;
    this.ibase = ibase;
}

// Number of shared Int32 locations needed by the lock.
Lock.NUMINTS = 1;

// Initialize shared memory for a lock, before constructing the
// worker-local Lock objects on that memory.
//
// 'iab' must be an Int32Array mapping shared memory.
// 'ibase' must be a valid index in iab, the first of Lock.NUMINTS reserved
// for the lock.
//
// Returns 'ibase'.
Lock.initialize =
    function (iab, ibase) {
	if (!(iab instanceof Int32Array && ibase|0 == ibase && ibase >= 0 && ibase+Lock.NUMINTS <= iab.length))
	    throw new Error("Bad arguments to Lock initializer: " + iab + " " + ibase);
	Atomics.store(iab, ibase, 0);
	return ibase;
    };

// Acquire the lock, or block until we can.  Locking is not recursive:
// you must not hold the lock when calling this.
Lock.prototype.lock =
    function () {
        const iab = this.iab;
        const stateIdx = this.ibase;
        var c;
        if ((c = Atomics.compareExchange(iab, stateIdx, 0, 1)) != 0) {
            do {
                if (c == 2 || Atomics.compareExchange(iab, stateIdx, 1, 2) != 0)
                    Atomics.wait(iab, stateIdx, 2, Number.POSITIVE_INFINITY);
            } while ((c = Atomics.compareExchange(iab, stateIdx, 0, 2)) != 0);
        }
    };

// Attempt to acquire the lock, return true if it was acquired, false
// if not.  Locking is not recursive: you must not hold the lock when
// calling this.
Lock.prototype.tryLock =
    function () {
        const iab = this.iab;
        const stateIdx = this.ibase;
        return Atomics.compareExchange(iab, stateIdx, 0, 1) == 0;
    };

// Unlock a lock that is held.  Anyone can unlock a lock that is held;
// nobody can unlock a lock that is not held.
Lock.prototype.unlock =
    function () {
        const iab = this.iab;
        const stateIdx = this.ibase;
        var v0 = Atomics.sub(iab, stateIdx, 1);
        // Wake up a waiter if there are any
        if (v0 != 1) {
            Atomics.store(iab, stateIdx, 0);
            Atomics.wake(iab, stateIdx, 1);
        }
    };

Lock.prototype.toString =
    function () {
	return "Lock:{ibase:" + this.ibase +"}";
    };

//////////////////////////////////////////////////////////////////////
//
// Condition variables.
//
// Condition variables are JS objects that use some shared memory for
// private data.  The number of shared int32 locations needed is given
// by Cond.NUMINTS.  The shared memory for a condition variable should
// be initialized once by calling Cond.initialize() on the memory,
// before constructing the first Cond object in any agent.
//
//
// Implementation note:
// The condvar code is based on http://locklessinc.com/articles/mutex_cv_futex,
// though modified because some optimizations in that code don't quite apply.
//
// Again, using Synchronic might be easier.

// Create a condition variable that can wait on a lock.
//
// 'lock' is an instance of Lock.
// 'ibase' must be a valid index in lock.iab, the first of Cond.NUMINTS reserved
// for the condition.
//
// lock.iab and ibase will be exposed on Cond.
function Cond(lock, ibase) {
    if (!(lock instanceof Lock && ibase|0 == ibase && ibase >= 0 && ibase+Cond.NUMINTS <= lock.iab.length))
	throw new Error("Bad arguments to Cond constructor: " + lock + " " + ibase);
    this.iab = lock.iab;
    this.ibase = ibase;
    this.lock = lock;
}

// Number of shared Int32 locations needed by the condition variable.
Cond.NUMINTS = 1;

// Initialize shared memory for a condition variable, before
// constructing the worker-local Cond objects on that memory.
//
// Returns 'ibase'.
Cond.initialize =
    function (iab, ibase) {
	if (!(iab instanceof Int32Array && ibase|0 == ibase && ibase >= 0 && ibase+Cond.NUMINTS <= iab.length))
	    throw new Error("Bad arguments to Cond initializer: " + iab + " " + ibase);
	Atomics.store(iab, ibase, 0);
	return ibase;
    };

// Atomically unlocks the cond's lock and wait for a wakeup on the
// cond.  If there were waiters on lock then they are woken as the
// lock is unlocked.
//
// The caller must hold the lock when calling wait().  When wait()
// returns the lock will once again be held.
Cond.prototype.wait =
    function () {
        const iab = this.iab;
        const seqIndex = this.ibase;
        const seq = Atomics.load(iab, seqIndex);
        const lock = this.lock;
        lock.unlock();
        Atomics.wait(iab, seqIndex, seq, Number.POSITIVE_INFINITY);
        lock.lock();
    };

// Wakes one waiter on cond.  The cond's lock must be held by the
// caller of wake().
Cond.prototype.wake =
    function () {
        const iab = this.iab;
        const seqIndex = this.ibase;
        Atomics.add(iab, seqIndex, 1);
        Atomics.wake(iab, seqIndex, 1);
    };

// Wakes all waiters on cond.  The cond's lock must be held by the
// caller of wakeAll().
Cond.prototype.wakeAll =
    function () {
        const iab = this.iab;
        const seqIndex = this.ibase;
        Atomics.add(iab, seqIndex, 1);
        // Optimization opportunity: only wake one, and requeue the others
        // (in such a way as to obey the locking protocol properly).
        Atomics.wake(iab, seqIndex, 65535);
    };

Cond.prototype.toString =
    function () {
	return "Cond:{ibase:" + this.ibase +"}";
    };

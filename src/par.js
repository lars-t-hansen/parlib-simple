/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// REQUIRE:
//   asymmetric-barrier.js
//   marshaler.js

// This is a data-parallel framework that maintains a worker pool and
// invokes computations in parallel on those workers, with automatic
// marshaling of arguments.
//
// On the master (usually the main thread), create a new MasterPar
//   object M that will control the computation.  It will create a
//   number of new workers with the provided URL.
//
// On each new worker, create a new WorkerPar object W that will
//   receive and process work requests.
//
// Call M.invoke() to invoke a function on subsets of an index space
//   across workers.  The index space is split up according to
//   heuristics or directives, and there is load balancing.  You can
//   pass arguments; they are transmitted for you to the workers.
//   Often, at least one of the arguments is a shared-memory array
//   that will receive the results of the computation.
//
// Call M.broadcast() to invoke a function once on all workers in the
//   pool.  This is useful for precomputing intermediate data or
//   distributing invariant parameters.
//
// Call M.eval() to eval a program in each worker.  This is useful for
//   broadcasting program code or performing precomputation.
//
// Each worker must call W.dispatch() when it receives a message from
//   its parent, and otherwise just define the global functions that
//   will be referenced by remote invocations.

"use strict";

// Create a MasterPar object.
//
// 'iab' is a SharedInt32Array.
// 'ibase' is the first of MasterPar.NUMINTS locations in iab reserved
//    for the Par system.
// 'numWorkers' must be a positive integer, the number of workers in
//    the pool.
// 'workerScript' must be a URL, the script containing worker code.
// 'readyCallback' must be a function.
//
// This will create a new worker pool with the number of workers and
// the given script.  When the workers are all up and running,
// readyCallback will be invoked with no arguments.
//
// No further setup is necessary, but see the description at the
// WorkerPar constructor for information about what needs to happen on
// the worker side.
//
// There can be multiple MasterPar objects in the same realm, they
// will each have their own worker pool.
//
// (The arguments iab, ibase, numWorkers, and workerScript are exposed
// on the MasterPar instance.)

function MasterPar(iab, ibase, numWorkers, workerScript, readyCallback) {
    const self = this;
    const barrierID = 1337;	// TODO: pick something non-constant?

    this.iab = iab;
    this.ibase = ibase;
    this.numWorkers = numWorkers;
    this.workerScript = workerScript;

    this._alloc = ibase;
    this._limit = ibase + MasterPar.NUMINTS;
    this._barrierLoc = alloc(MasterBarrier.NUMINTS);
    this._barrier = new MasterBarrier(iab, this._barrierLoc, barrierID, numWorkers, barrierQuiescent);
    this._opLoc = alloc(1);
    this._funcLoc = alloc(1);
    this._sizeLoc = alloc(1);
    this._nextLoc = alloc(1);
    this._limLoc = alloc(1);
    this._nextArgLoc = alloc(1);
    this._argLimLoc = alloc(1);
    this._callback = readyCallback;
    this._marshaler = new Marshaler();
    this._marshaler.registerSAB(iab.buffer, 0);
    this._workers = [];
    this._queue = [];

    for ( var i=0 ; i < numWorkers ; i++ ) {
	var w = new Worker(workerScript);
	w.onmessage = messageHandler;
	w.postMessage(["WorkerPar.start",
		       iab.buffer, iab.byteOffset, i,
		       this._barrierLoc, barrierID, this._opLoc, this._funcLoc, this._sizeLoc, this._nextLoc,
		       this._limLoc, this._nextArgLoc, this._argLimLoc],
		      [iab.buffer]);
	this._workers.push(w);
    }

    function alloc(n) {
	var p = self._alloc;
	self._alloc += n;
	return p;
    }

    function barrierQuiescent() {
	var fn;
	if (fn = self._callback) {
	    self._callback = null;
	    fn();
	}
	else
	    throw new Error("No barrier callback installed!");
    }

    function messageHandler(ev) {
	var handled = false;
	if (Array.isArray(ev.data) && ev.data.length >= 1) {
	    if (ev.data[0] === "MasterBarrier.dispatch") {
		handled = true;
		MasterBarrier.dispatch(ev.data);
	    }
	}
	if (!handled)
	    self.messageNotUnderstood(ev.data);
    }
}

// Number of integer locations reserved for working storage for the
// Par framework.
//
// (64K slots is very generous, but allows for fine-grained
// invocations across large index spaces or with many arguments.)

MasterPar.NUMINTS = 65536;

// messageNotUnderstood()
//
// This method is invoked if a worker posts a message that is not
// understood by the Par framework.  The argument is the event data
// object.  The method can do with the message what it wants.  The
// method's return value is ignored.

MasterPar.prototype.messageNotUnderstood =
    function (message) {
	console.log(message);
    };

// Private constants.

const _PAR_INVOKE = 1;
const _PAR_BROADCAST = 2;
const _PAR_MSGLOOPEXIT = 3;

// invoke()
//
// Invoke a function in parallel on sections of an index space, with
// load balancing.
//
// doneCallback is a function or null.  If a function, it will be
//   invoked in the master with no arguments once the work is finished.
// fnIdent is the string identifier of the remote function to invoke,
//   it names a function in the global scope of the worker.
// indexSpace is an array of length-2 arrays determining the index
//   space of the computation; workers will be invoked on subvolumes
//   of this space in an unpredictable order.
// The ...args can be SharedTypedArray, SharedArrayBuffer, number,
//   bool, string, undefined, or null values and will be marshalled
//   and passed as arguments to the user function on the worker side.
//
// Returns nothing.
//
// The handler function identified by fnIdent will be invoked on the
// following arguments, in order:
//   base and limit values for each element in indexSet, in order
//   any additional ...args
// Thus if the length of indexSet is three and there are four
// additional arguments then the number of arguments is 2*3+4.
//
// Serialization of calls: You can call invoke, broadcast, or eval
// repeatedly without waiting for callbacks.  The calls will be queued
// by the framework and dispatched in order.  All object arguments
// will be retained by reference while a call is queued; beware of
// side effects.
//
// Note, however, that the queueing system currently depends on a
// system-supplied callback, so the master must return to its event
// loop for the dispatching of queued tasks.

MasterPar.prototype.invoke =
    function (doneCallback, fnIdent, indexSpace, ...args) {
	if (!Array.isArray(indexSpace) || indexSpace.length < 1)
	    throw new Error("Bad indexSpace: " + indexSpace);
	for ( var x of indexSpace )
	    if (x.length != 2 || typeof x[0] != 'number' || typeof x[1] != 'number' || (x[0]|0) != x[0] || (x[1]|0) != x[1])
		throw new Error("Bad indexSpace element " + x)
	this._comm(_PAR_INVOKE, doneCallback, fnIdent, indexSpace, args);
    };

// broadcast()
//
// Invoke a function once on each worker.
//
// doneCallback is a function or null.  If a function, it will be
//   invoked in the master once the work is finished.
// fnIdent is the string identifier of the remote function to invoke,
//   it names a function in the global scope of the worker.
// The ...args can be values of the types as described for build(),
//   and will be marshalled and passed as arguments to the user
//   function on the worker side.
//
// Returns nothing.
//
// The handler function identified by fnIdent will be invoked on the
// ...args only, no other arguments are passed.
//
// See the note about serialization of calls on the documentation for
// invoke().

MasterPar.prototype.broadcast =
    function(doneCallback, fnIdent, ...args) {
	this._comm(_PAR_BROADCAST, doneCallback, fnIdent, [], args);
    };

// eval()
//
// Evaluate a program once on each worker.
//
// doneCallback is a function or null.  If a function, it will be
//   invoked in the master once the work is finished.
// program is textual program code, to be evaluated in the global
//   scope of the worker.
//
// Returns nothing.
//
// See the note about serialization of calls on the documentation for
// invoke().

MasterPar.prototype.eval =
    function (doneCallback, program) {
	this._comm(_PAR_BROADCAST, doneCallback, "_WorkerPar_eval", [], [program]);
    };

// Internal

MasterPar.prototype._comm =
    function (operation, doneCallback, fnIdent, indexSpace, args) {
	const self = this;
	const M = self.iab;

	// Operation in flight?  Just enqueue this one.
	if (self._callback) {
	    self._queue.push([operation, doneCallback, fnIdent, indexSpace, args]);
	    return;
	}

	if (!self._barrier.isQuiescent())
	    throw new Error("Internal: call on MasterPar._comm before the previous call has completed");

	var items;
	switch (indexSpace.length) {
	case 0:
	    // Broadcast
	    items = [];
	    break;
	case 1:
	    items = sliceSpace(indexSpace[0][0], indexSpace[0][1]);
	    break;
	case 2:
	    items = cross(sliceSpace(indexSpace[0][0], indexSpace[0][1]), sliceSpace(indexSpace[1][0], indexSpace[1][1]));
	    break;
	default:
	    throw new Error("Implementation limit: Only 1D and 2D supported as of now: " + items);
	}
	const itemSize = indexSpace.length * 2;
	var { values, newSAB } = self._marshaler.marshal(args);
	if (doneCallback === null)
	    doneCallback = processQueue;
	else
	    doneCallback = (function (doneCallback) {
		return function () {
		    processQueue();
		    doneCallback();
		} })(doneCallback);

	if (newSAB.length > 0) {
	    self._callback =
		function () {
		    self._callback = doneCallback;
		    var p = self._alloc;
		    p = installArgs(p, values);
		    p = installItems(operation, p, fnIdent, itemSize, items);
		    if (p >= self._limit)
			throw new Error("Not enough working memory");
		    if (!self._barrier.release())
			throw new Error("Internal barrier error @ 1");
		};

	    // Signal message loop exit so that we can effectuate a transfer.
	    M[self._opLoc] = _PAR_MSGLOOPEXIT;

	    // Transmit buffers
	    var xfer = [];
	    var yfer = [];
	    for ( var x of newSAB ) {
		xfer.push([x.sab, x.id]);
		yfer.push(x.sab);
	    }
	    xfer.unshift("WorkerPar.transfer");
	    for ( var w of self._workers )
		w.postMessage(xfer, yfer);
	}
	else {
	    self._callback = doneCallback;
	    var p = self._alloc;
	    p = installArgs(p, values);
	    p = installItems(operation, p, fnIdent, itemSize, items);
	    if (p >= M.length)
		throw new Error("Not enough working memory");
	}
	if (!self._barrier.release())
	    throw new Error("Internal barrier error @ 2");

	function processQueue() {
	    if (self._queue.length)
		self._comm.apply(self, self._queue.shift());
	}

	function sliceSpace(lo, lim) {
	    var items = [];
	    var numItem = (lim - lo);
	    var sliceHeight = Math.floor(numItem / (4*self.numWorkers));
	    var extra = numItem % (4*self.numWorkers);
	    while (lo < lim) {
		var hi = lo + sliceHeight;
		if (extra) {
		    hi++;
		    extra--;
		}
		items.push([lo, hi]);
		lo = hi;
	    }
	    return items;
	}

	function cross(as, bs) {
	    var items = [];
	    for ( var a of as )
		for ( var b of bs )
		    items.push([a, b]);
	    return items;
	}

	function installArgs(p, values) {
	    M[self._nextArgLoc] = p;
	    for ( var v of values )
		M[p++] = v;
	    M[self._argLimLoc] = p;
	    return p;
	}

	function installItems(operation, p, fn, wordsPerItem, items) {
	    M[self._sizeLoc] = wordsPerItem;
	    M[self._opLoc] = operation;
	    M[self._funcLoc] = p;
	    M[p++] = fn.length;
	    for ( var c of fn )
		M[p++] = c.charCodeAt(0);
	    M[self._nextLoc] = p;
	    switch (wordsPerItem) {
	    case 0:
		break;
	    case 2:
		for ( var i of items )
		    for ( var j of i )
			M[p++] = j;
		break;
	    case 4:
		for ( var i of items )
		    for ( var j of i )
			for ( var k of j )
			    M[p++] = k;
		break;
	    }
	    M[self._limLoc] = p;
	    return p;
	}
    };

// Create a WorkerPar object.
//
// The client's worker code must ensure that the WorkerPar instance's
// dispatch() method is invoked when a message is received.  That
// method will return true if it consumed the message.  Typically:
//
//   var wp = new WorkerPar();
//   onmessage =
//       function (ev) {
//           if (!wp.dispatch(ev.data))
//              handleMessageSomehow(ev.data);
//       };
//
// Note that it does not normally make sense to create multiple
// WorkerPar objects in the same worker, and doing so is not supported
// by current code.

function WorkerPar() {
    this._initialized = false;
}

// self()
//
// Get the identity of this worker.  Identities are allocated in a
// dense space starting at zero.

Object.defineProperty(WorkerPar.prototype,
		      "self",
		      { get: function () { return this._identity } });

// Attempt to dispatch a message.
//
// 'message' is the event's 'data' field.
//
// Return true if the message was consumed, false if not.  See comment
// above the WorkerPar constructor for more.

WorkerPar.prototype.dispatch =
    function (message) {
        if (!Array.isArray(message) || typeof message[0] != 'string')
	    return false;
	switch (message[0]) {
	case "WorkerPar.start":
	    if (this._initialized)
		throw new Error("WorkerPar can only be initialized once");
	    this._initialize(message);
	    this._messageLoop();
	    return true;

	case "WorkerPar.transfer":
	    if (!this._initialized)
		throw new Error("WorkerPar is not yet initialized");
	    var info = message;
	    info.shift();
	    for ( var [sab,id] of info )
		this._marshaler.registerSAB(sab, id);
	    this._messageLoop();
	    return true;

	default:
	    return false;
	}
    };

// Internal

const _Par_global = this;

WorkerPar.prototype._initialize =
    function (message) {
	var [_, sab, byteOffset, identity, barrierLoc, barrierID, opLoc, funcLoc, sizeLoc, nextLoc, limLoc, nextArgLoc, argLimLoc] = message;
	this.iab = new SharedInt32Array(sab, byteOffset, MasterPar.NUMINTS);
	this._barrier = new WorkerBarrier(this.iab, barrierLoc, barrierID);
	this._identity = identity;
	this._opLoc = opLoc;
	this._funcLoc = funcLoc;
	this._sizeLoc = sizeLoc;
	this._nextLoc = nextLoc;
	this._limLoc = limLoc;
	this._nextArgLoc = nextArgLoc;
	this._argLimLoc = argLimLoc;
	this._marshaler = new Marshaler();
	this._marshaler.registerSAB(sab, 0);
	this._initialized = true;
    };

WorkerPar.prototype._messageLoop =
    function () {
	const M = this.iab;

	for (;;) {
	    this._barrier.enter();
	    var operation = M[this._opLoc];

	    if (operation == _PAR_MSGLOOPEXIT)
		break;

	    var size = M[this._sizeLoc];
	    var limit = M[this._limLoc];
	    var nextArg = M[this._nextArgLoc];
	    var argLimit = M[this._argLimLoc];

	    var item = Atomics.add(M, this._nextLoc, size);
	    var args = this._marshaler.unmarshal(M, nextArg, argLimit-nextArg);

	    var p = M[this._funcLoc];
	    var l = M[p++];
	    var id = "";
	    for ( var i=0 ; i < l ; i++ )
		id += String.fromCharCode(M[p++]);
	    var fn = _Par_global[id];
	    if (!fn || !(fn instanceof Function))
		throw new Error("No function installed for ID '" + id + "'");

	    if (operation == _PAR_BROADCAST) {
		fn.apply(null, args);
		continue;
	    }

	    // Can specialize the loop for different values of args.length
	    if (args.length > 0) {
		switch (size) {
		case 2: args.unshift(0, 0); break;
		case 4: args.unshift(0, 0, 0, 0); break;
		}
	    }
	    while (item < limit) {
		switch (size) {
		case 2:
		    switch (args.length) {
		    case 0:
			fn(M[item], M[item+1]);
			break;
		    default:
			// Can specialize this for small values of args.length, to avoid apply
			args[0] = M[item];
			args[1] = M[item+1];
			fn.apply(null, args);
			break;
		    }
		    break;
		case 4:
		    switch (args.length) {
		    case 0:
			fn(M[item], M[item+1], M[item+2], M[item+3]);
			break;
		    default:
			// Can specialize this for small values of args.length, to avoid apply
			args[0] = M[item];
			args[1] = M[item+1];
			args[2] = M[item+2];
			args[3] = M[item+3];
			fn.apply(null, args);
			break;
		    }
		    break;
		default:
		    throw new Error("Only 1D and 2D computations supported");
		}
		item = Atomics.add(M, this._nextLoc, size);
	    }
	}
    };

function _WorkerPar_eval(program) {
    _Par_global.eval(program);
}

//
// TODO:
//  - When a callback is null, the full master/worker barrier is not
//    needed, a worker-only barrier is enough and is probably quite a
//    bit faster.  It would be useful to implement that optimization.
//
//    Indeed, when operations are queued, the current implementation
//    still makes use of the master-worker barrier and the callback
//    mechanism, meaning the master must return to the event loop for
//    queued items to be processed, and is actually holding up
//    progress if it does not return to the main loop on a fairly
//    prompt basis.  Using the worker-only barrier would probably help
//    remove that requirement (which is documented).
//
//    The way to implement that is probably with a level of
//    indirection, where there are several complete task queues in the
//    working memory (each with a next and limit pointer), where each
//    queue may carry some indication about which barrier to use at
//    the end.  (A little tricky that, since the master must still
//    unblock the workers if they finish available work before more
//    work is ready.  What we really want is a master/worker barrier
//    where the master can register interest in control and/or
//    callback or not, dynamically.  It is possible that a way to
//    resilience is for the barrier callback to pass a sequence
//    number, so as to avoid confusion about earlier sent callbacks.)
//
//  - Nested parallelism is desirable, ie, a worker should be allowed
//    to invoke Multicore.build, suspending until that subcomputation
//    is done.  (Broadcast and eval are less obvious.)
//
//  - There is unnecessary lock overhead in having the single work
//    queue (the pointer for the next item is hotly contended), that
//    might be improved by having per-worker queues with work stealing
//    or some sort of batch refilling.  It should not matter too much
//    if the grain is "right" (see later item on hinting) because then
//    computation will dominate communication, but it would be useful
//    to know, and cheaper communication would allow for better
//    speedup of cheap computations.
//
// API CONCERNS:
//  - Since we don't have memory isolation in this conception of
//    Multicore.build, and the output array can be passed as an
//    argument in any case, it may be that we should move to a
//    Multicore.invoke(cb, name, idx, arg, ...) style, and get rid of
//    build() in its current form.
//
//  - The original conception of Multicore.build would operate on
//    individual index range elements unless an index was SPLIT.  In
//    the conception here, the index is always split.  Is this
//    reasonable, or should we incorporate the non-tiled API as well?
//
//  - The original conception of Multicore.build allowed the index
//    space to contain hints to aid load balancing.  It would be
//    useful to import that idea, probably, or at least experiment
//    with it to see if it really affects performance.

/*
Master/worker protocol.

There are seven distinguished locations in the private working memory
that are distributed to the workers on startup:

  barrierLoc  - the first location for the shared barrier sync
  funcLoc     - holds the index of the function name representation
  sizeLoc     - holds the number of words in a work item
  nextLoc     - holds the array index of the next work item
  limLoc      - holds the first array index past the last work item
  nextArgLoc  - holds the index of the first argument
  argLimLoc   - holds the first array index past the last argument

The function name is a sequence of values: the first value is the
number of characters in the name, then follows one character per
element.

The worker creates a barrier on the barrierLoc and then enters that
barrier, and thus we're off.

The master has the following actions it wants to accomplish:

 - transfer new SAB values
 - perform parallel work
 - broadcast something


Transfer:

The workers are made to exit their message loop by passing a
distinguished value and releasing them from the barrier.  New messages
are then sent to them to transfer the new SAB values; the workers
receive them and register them and re-enter the message loop.


Computation:

One or more "arguments" are passed in the args area.

Suppose nextArgLoc < argLimLoc.  Let A=nextArgLoc and M be the
private working memory.

  the M[A] is a tag: int, float, bool, null, undefined, sab, or sta
  if tag==null or tag==undefined then there's no data
  if tag==bool then the eighth bit of the tag is 1 or 0
  if tag==int, then the int follows immediately
  if tag==float, there may be padding and then the float follows immediately
    in native word order
  if tag==string, the high 24 bits of the tag are the string's length,
    and the following ceil(length/2) words are characters, in order,
    packed (hi << 16)|lo to each word
  if tag==sab, then there is one argument word:
    - sab identifier
  if tag==sta, then the tag identifies the array type, and there are
    the following three argument words:
    - sab identifier
    - byteoffset, or 0 for
    - element count

The first argument is always the output array, and it must be a SAB or
array type.

The arguments past the first are passed to the worker as arguments
after the index space arguments.


Broadcast:

This is exactly as for computation, except that the output array
argument is always the Multicore system's private metadata SAB, and
there are no work items.  The worker side recognizes the array as a
signal and calls the target function once on each worker.

*/

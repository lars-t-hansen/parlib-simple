// Data-parallel framework on shared memory.

// REQUIRE:
//   marshal.js
//   asymmetric-barrier.js

// A simple data-parallel framework that maintains a worker pool and
// invokes computations in parallel on shared memory.
//
// Load this into your main program, after loading marshal.js and
// asymmetric-barrier.js.
//
// Call Multicore.init() to set things up, once.
//
// Call Multicore.build() to distribute and perform computation.
//
// Call Multicore.broadcast() to invoke a function on all workers, eg
// to precompute intermediate data or distribute invariant parameters.
//
// Call Multicore.eval() to eval a program in each worker, eg to
// broadcast program code or precomputations.

"use strict";

// MulticoreMaster constructor.
//
// iab is a SharedInt32Array.
// ibase is the first of MulticoreMaster.NUMINTS locations
//   in iab reserved for the Multicore system.
// numWorkers must be a positive integer.
// workerScript must be a URL.
// readyCallback must be a function, it will be called without arguments
//   when the workers have been set up.

function MulticoreMaster(iab, ibase, numWorkers, workerScript, readyCallback) {
    this.iab = iab;
    this.ibase = ibase;
    this._numWorkers = numWorkers;
    this._alloc = ibase;
    this._limit = ibase + MulticoreMaster.NUMINTS;
    this._barrierLoc = _Multicore_alloc;
    this._barrier = new MasterBarrier(0x1337, // TODO: can we pick something non-constant, please?
				      this._numWorkers,
				      this.iab,
				      this._barrierLoc,
				      barrierQuiescent);
    this._alloc += MasterBarrier.NUMLOCS;
    this._funcLoc = _Multicore_alloc++;
    this._sizeLoc = _Multicore_alloc++;
    this._nextLoc = _Multicore_alloc++;
    this._limLoc = _Multicore_alloc++;
    this._nextArgLoc = _Multicore_alloc++;
    this._argLimLoc = _Multicore_alloc++;
    this._callback = readyCallback;
    this._marshaler = new Marshaler();
    this._marshaler.registerSAB(this.iab.buffer);

    for ( var i=0 ; i < numWorkers ; i++ ) {
	var w = new Worker(workerScript);
	w.onmessage = messageHandler;
	w.postMessage(["start",
		       this.iab.buffer,
		       this._barrierLoc, this._funcLoc, this._sizeLoc, this._nextLoc, this._limLoc,
		       this._nextArgLoc, this._argLimLoc],
		      [this.iab.buffer]);
	this._workers.push(w);
    }

    const self = this;

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
	if (Array.isArray(ev.data) && ev.data.length >= 1) {
	    switch (ev.data[0]) {
	    case "MasterBarrier.dispatch":
		MasterBarrier.dispatch(ev.data);
		break;
	    default:
		console.log(ev.data);
		break;
	    }
	}
	else
	    console.log(ev.data);
    }
}

MulticoreMaster.NUMINTS = 65536;


// Multicore.build()
//
// Invoke a function in parallel on sections of an index space,
// producing output into a predefined shared memory array.
//
// doneCallback is a function or null.  If a function, it will be
//   invoked in the master once the work is finished.
// fnIdent is the string identifier of the remote function to invoke,
//   it names a function in the global scope of the worker.
// outputMem is a SharedTypedArray or SharedArrayBuffer that will (in
//   principle, though it's up to user code) receive the results of
//   the computation.
// indexSpace is an array of length-2 arrays determining the index
//   space of the computation; workers will be invoked on subvolumes
//   of this space in an unpredictable order.
// The ...args can be SharedTypedArray, SharedArrayBuffer, number,
//   bool, string, undefined, or null values and will be marshalled
//   and passed as arguments to the user function on the worker side.
//
// The handler function identified by fnIdent will be invoked on the
// following arguments, in order:
//   outpuMem
//   base and limit values for each element in indexSet, in order
//   any additional ...args
// Thus if the length of indexSet is three and there are four
// additional arguments then the number of arguments is 1+2*3+4.
//
// Serialization of calls: You can call build, broadcast, or eval
// repeatedly without waiting for callbacks.  The calls will be queued
// by the framework and dispatched in order.  All object arguments
// will be retained by reference while a call is queued; beware of
// side effects.
//
// Note, however, that the queueing system currently depends on a
// system-supplied callback, so the master must return to its event
// loop for the dispatching of queued tasks.

MulticoreMaster.prototype.build =
    function (doneCallback, fnIdent, outputMem, indexSpace, ...args) {
	if (!Array.isArray(indexSpace) || indexSpace.length < 1)
	    throw new Error("Bad indexSpace: " + indexSpace);
	for ( var x of indexSpace )
	    if (x.length != 2 || typeof x[0] != 'number' || typeof x[1] != 'number' || (x[0]|0) != x[0] || (x[1]|0) != x[1])
		throw new Error("Bad indexSpace element " + x)
	// TODO: should check that type of outputMem is SharedArrayBuffer or SharedTypedArray
	if (!outputMem)
	    throw new Error("Bad output memory: " + outputmem);
	return _Multicore_comm(doneCallback, fnIdent, outputMem, indexSpace, args);
    };

// Multicore.broadcast()
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
// The handler function identified by fnIdent will be invoked on the
// ...args only, no other arguments are passed.
//
// See the note about serialization of calls on the documentation for
// Multicore.build().

MulticoreMaster.prototype.broadcast =
    function(doneCallback, fnIdent, ...args) {
	return _Multicore_comm(doneCallback, fnIdent, null, [], args);
    };

// Multicore.eval()
//
// Evaluate a program once on each worker.
//
// doneCallback is a function or null.  If a function, it will be
//   invoked in the master once the work is finished.
// program is textual program code, to be evaluated in the global
//   scope of the worker.
//
// See the note about serialization of calls on the documentation for
// Multicore.build().

MulticoreMaster.prototype.eval =
    function (doneCallback, program) {
	_Multicore_broadcast(doneCallback, "_Multicore_eval", program);
    };




// Internal

MulticoreMaster.prototype._comm =
    function (doneCallback, fnIdent, outputMem, indexSpace, args) {
	const M = _Multicore_mem;

	// Operation in flight?  Just enqueue this one.
	if (_Multicore_callback) {
	    _Multicore_queue.push([doneCallback, fnIdent, outputMem, indexSpace, args]);
	    return;
	}

	// Broadcast
	if (outputMem === null)
	    outputMem = _Multicore_mem.buffer;
	if (!_Multicore_barrier.isQuiescent())
	    throw new Error("Do not call Multicore.build until the previous call has completed!");
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
	    throw new Error("Only 1D and 2D supported as of now");
	}
	const itemSize = indexSpace.length * 2;
	var { argValues, newSAB } = processArgs(outputMem, args);
	if (doneCallback === null)
	    doneCallback = processQueue;
	else
	    doneCallback = (function (doneCallback) {
		return function () {
		    processQueue();
		    doneCallback();
		} })(doneCallback);
	if (newSAB.length) {
	    _Multicore_callback =
		function () {
		    _Multicore_callback = doneCallback;
		    var p = _Multicore_alloc;
		    p = installArgs(p, argValues);
		    p = installItems(p, fnIdent, itemSize, items);
		    if (p >= M.length)
			throw new Error("Not enough working memory");
		    if (!_Multicore_barrier.release())
			throw new Error("Internal barrier error @ 1");
		};
	    // Signal message loop exit.
	    // Any negative number larger than numWorkers will do.
	    M[_Multicore_funcLoc] = -1;
	    M[_Multicore_sizeLoc] = 0;
	    M[_Multicore_nextLoc] = -1000000;
	    // Transmit buffers
	    var xfer = [];
	    for ( var x of newSAB )
		xfer.push(x[0]);
	    newSAB.unshift("transfer");
	    for ( var w of _Multicore_workers )
		w.postMessage(newSAB, xfer);
	}
	else {
	    _Multicore_callback = doneCallback;
	    var p = _Multicore_alloc;
	    p = installArgs(p, argValues);
	    p = installItems(p, fnIdent, itemSize, items);
	    if (p >= M.length)
		throw new Error("Not enough working memory");
	}
	if (!_Multicore_barrier.release())
	    throw new Error("Internal barrier error @ 2");

	function processQueue() {
	    if (_Multicore_queue.length)
		_Multicore_comm.apply(Multicore, _Multicore_queue.shift());
	}

	function sliceSpace(lo, lim) {
	    var items = [];
	    var numItem = (lim - lo);
	    var sliceHeight = Math.floor(numItem / (4*_Multicore_numWorkers));
	    var extra = numItem % (4*_Multicore_numWorkers);
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
	    M[_Multicore_nextArgLoc] = p;
	    for ( var v of values )
		M[p++] = v;
	    M[_Multicore_argLimLoc] = p;
	    return p;
	}

	function installItems(p, fn, wordsPerItem, items) {
	    M[_Multicore_sizeLoc] = wordsPerItem;
	    M[_Multicore_funcLoc] = p;
	    M[p++] = fn.length;
	    for ( var c of fn )
		M[p++] = c.charCodeAt(0);
	    M[_Multicore_nextLoc] = p;
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
	    M[_Multicore_limLoc] = p;
	    return p;
	}
    };

//////////////////////////////////////////////////////////////////////
//
// Takes what arguments?  None, because it gets them all from the master by message.
// Returns what values?  (Probably a message handler that will be invoked when messages
// are array messages with the tag MulticoreWorker.start and MulticoreWorker.transfer)

/*
   On the worker:

   // we could tag it with a given task and thus have multiple workers.  But why, when
   // all it does is look up a function and invoke it?  It's enough to have one, but
   // it's useful to be able to patch other things into the message loop, like here.

   var worker = new MulticoreWorker();
   onmessage =
       function (ev) {
           if (worker(ev))
              ;
           else ...
       }
*/

function MulticoreWorker() {
    this._initialized = false;
    return MulticoreWorker.prototype._messageHandler.bind(this);
}

MulticoreWorker.prototype._messageHandler =
    function (ev) {
        if (!Array.isArray(ev.data) || typeof ev.data[0] != 'string') return false;
	switch (ev.data[0]) {
	case "MulticoreWorker.start":
	    // This would not be a limitation if we also had some ID...
	    if (this._initialized)
		throw new Error("MulticoreWorker can only be initialized once");

	    var [_, sab, barrierLoc, funcLoc, sizeLoc, nextLoc, limLoc, nextArgLoc, argLimLoc] = ev.data;
	    this.iab = new SharedInt32Array(sab);
	    this._barrier = new WorkerBarrier(0x1337, this.iab, barrierLoc); // TODO: barrier ID should be controlled by master
	    this._funcLoc = funcLoc;
	    this._sizeLoc = sizeLoc;
	    this._nextLoc = nextLoc;
	    this._limLoc = limLoc;
	    this._nextArgLoc = nextArgLoc;
	    this._argLimLoc = argLimLoc;
	    this._marshaler = new Marshaler();
	    this._marshaler.registerSAB(sab);
	    this._initialized = true;
	    this._messageLoop();
	    return true;

	case "MulticoreWorker.transfer":
	    if (!this._initialized)
		throw new Error("MulticoreWorker is not yet initialized");

	    var info = ev.data;
	    info.shift();
	    for ( var [sab,k] of info )
		this._marshaler.registerSAB(sab, k);
	    this._messageLoop();
	    return true;

	default:
	    return false;
	}
    };

MulticoreWorker.prototype._messageLoop =
    function () {
	const M = this.iab;

	for (;;) {
	    _Multicore_barrier.enter();
	    var size = M[_Multicore_sizeLoc];
	    var limit = M[_Multicore_limLoc];
	    var nextArg = M[_Multicore_nextArgLoc];
	    var argLimit = M[_Multicore_argLimLoc];

	    var item = Atomics.add(M, _Multicore_nextLoc, size);
	    if (item < 0)
		break;

	    var userMem = parseArg();
	    var args = [];
	    while (nextArg < argLimit)
		args.push(parseArg());

	    var p = M[_Multicore_funcLoc];
	    var l = M[p++];
	    var id = "";
	    for ( var i=0 ; i < l ; i++ )
		id += String.fromCharCode(M[p++]);
	    var fn = _Multicore_global[id];
	    if (!fn || !(fn instanceof Function))
		throw new Error("No function installed for ID '" + id + "'");

	    // Passing the private memory as the output buffer is a special signal.
	    if (userMem == this.iab.buffer) {
		// Broadcast.  Do not expect any work items, just invoke the function and
		// reenter the barrier.
		fn.apply(null, args);
		continue;
	    }

	    // Can specialize the loop for different values of args.length
	    if (args.length > 0) {
		switch (size) {
		case 2: args.unshift(userMem, 0, 0); break;
		case 4: args.unshift(userMem, 0, 0, 0, 0); break;
		}
	    }
	    while (item < limit) {
		switch (size) {
		case 2:
		    switch (args.length) {
		    case 0:
			fn(userMem, M[item], M[item+1]);
			break;
		    default:
			// Can specialize this for small values of args.length
			args[1] = M[item];
			args[2] = M[item+1];
			fn.apply(null, args);
			break;
		    }
		    break;
		case 4:
		    switch (args.length) {
		    case 0:
			fn(userMem, M[item], M[item+1], M[item+2], M[item+3]);
			break;
		    default:
			// Can specialize this for small values of args.length
			args[1] = M[item];
			args[2] = M[item+1];
			args[3] = M[item+2];
			args[4] = M[item+3];
			fn.apply(null, args);
			break;
		    }
		    break;
		default:
		    throw new Error("Only 1D and 2D computations supported");
		}
		item = Atomics.add(M, _Multicore_nextLoc, size);
	    }
	}
    };

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

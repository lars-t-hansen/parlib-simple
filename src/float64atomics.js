/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Atomic operations on Float64Array on SharedArrayBuffer.
//
// The regular Atomics object does not provide atomic operations on
// Float64Array because not all plausible hardware can provide 8-byte
// atomic operations (ARMv6, MIPS32).
//
// This polyfill provides these operations:
//
//   Atomics.float64Load
//   Atomics.float64Store
//   Atomics.float64CompareExchange
//   Atomics.float64Add
//   Atomics.float64Sub
//
// and this initialization function:
//
//   Atomics.float64Init
//
// If an operation throws then the data word is either updated or not
// updated, and the coordination word is left in a state where it will
// not impede progress of other accessing threads.
//
// API notes:
//
// Once these get implemented natively they will be folded into the
// existing load(), store(), etc methods, and will lose their
// "float64" prefix.  Also, float64Init and NUMF64INTS will disappear.

// Implementation notes:
//
// We use a spinlock since no 64-bit CAS is provided by Atomics.
// There are multi-word CAS algorithms built from more primitive
// operations that claim to be practical (see eg
// http://www.timharris.co.uk/papers/2002-disc.pdf and for a wait-free
// one http://www.mscs.mu.edu/~brylow/SPLASH-MARC-2013/Feldman.pdf);
// such an algorithm would still require three or more data words and
// additionally some bit operations to rearrange the values, since the
// datum would be split across the three words to provide a bit of
// bookkeeping in each.

if (!Atomics.hasOwnProperty("float64Init")) {
    (function () {
	// Shared coordination data.

	var iab = null;
	var iidx = 0;

	// Temps used for last-ditch equality checking.  Could use
	// block-scoped "const" when that is available.

	var _f64tmp = new Float64Array(2);
	var _i32tmp = new Int32Array(_f64tmp.buffer);

	// float64Init must be called once with a Int32Array and an
	// index within that array that represents the start of a
	// range of Atomics.NUMF64INTS integers.  The shared memory
	// locations denoted by those values should be the same in all
	// agents, and they must be initialized to zero before the
	// first such call is made.

	Atomics.float64Init = function (iab_, iidx_) {
	    iab = iab_;
	    iidx = iidx_;
	}

	Atomics.NUMF64INTS = 1;

	// Atomically load fab[fidx] and return it.

	Atomics.float64Load = function (fab, fidx) {
	    while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
		;
	    try {
		return fab[fidx];
	    }
	    finally {
		Atomics.store(iab, iidx, 0);
	    }
	};

	// Atomically store v in fab[fidx].  Returns v.

	Atomics.float64Store = function (fab, fidx, v) {
	    while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
		;
	    try {
		fab[fidx] = v;
		return v;
	    }
	    finally {
		Atomics.store(iab, iidx, 0);
	    }
	};

	// Atomically compareExchange fab[fidx]: if its value is expected
	// then replace it with updated.  Returns the old value in the
	// cell.
	//
	// Equality is representation equality, which is a bit expensive
	// to simulate properly: 0 and NaN must be handled specially.
	//
	// There's an API problem here in that the 'old' value that is
	// returned is the only indication of whether an exchange was
	// performed, and client code must do the same song and dance for
	// equality checking again.  In C++11 a flag is additionally
	// returned to indicate whether the exchange took place.

	Atomics.float64CompareExchange = function (fab, fidx, expected, update) {
	    while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
		;
	    try {
		var v = fab[fidx];
		// Is the "fast path" an optimization or not?  The
		// expected case is that we do get to replace the value,
		// so I think it is, but I have no data.  And does it
		// matter?
		if (v != 0 && v == expected) // +0 != -0
		    fab[fidx] = update;
		else {
		    _f64tmp[0] = v;
		    _f64tmp[1] = expected;
		    if (_i32tmp[0] == _i32tmp[2] && _i32tmp[1] == _i32tmp[3])
			fab[fidx] = update;
		}
		return v;
	    }
	    finally {
		Atomics.store(iab, iidx, 0);
	    }
	};

	// Atomically add v to fab[fidx].  Returns the old value in the cell.

	Atomics.float64Add = function (fab, fidx, v) {
	    while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
		;
	    try {
		var w = fab[fidx];
		fab[fidx] += v;
		return w;
	    }
	    finally {
		Atomics.store(iab, iidx, 0);
	    }
	};

	// Atomically subtract v from fab[fidx].  Returns the old value in
	// the cell.

	Atomics.float64Sub = function (fab, fidx, v) {
	    while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
		;
	    try {
		var w = fab[fidx];
		fab[fidx] -= v;
		return w;
	    }
	    finally {
		Atomics.store(iab, iidx, 0);
	    }
	};
    })();
}


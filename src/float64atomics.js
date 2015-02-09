/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Atomic operations on SharedFloat64Array.
//
// The regular Atomics object does not (yet) provide atomic operations
// on SharedFloat64Array because not all plausible hardware can
// provide 8-byte atomic operations (ARMv6, MIPS32).
//
// This polyfill provides these operations:
//
//   Atomics.float64Load
//   Atomics.float64Store
//   Atomics.float64CompareExchange
//   Atomics.float64Add
//   Atomics.float64Sub
//
// The polyfilled operations may later be implemented natively, using
// faster mechanisms on platforms where they are available, or custom
// instruction sequences where that will be faster than the JS
// polyfill.
//
// Common to all these methods is that they take an additional
// SharedInt32Array and index within that array, and *may* use the
// word(s) at that index (Atomics.NUMF64INTS words) for coordination.
// The words should initially be zero.
//
// Atomicity via these operations is only guaranteed if all accesses
// use these operations, inbetween other synchronization points of
// accessing threads.
//
// If an operation throws then the data word is either updated or not
// updated, and the coordination word is left in a state where it will
// not impede progress of other accessing threads (actually hard).

// Usage notes:
//
// For best performance the coordination words for different items
// should not be packed together, but should be spread out so that
// they are on different cache lines.  Obviously this is
// hardware-dependent.

// API notes:
//
// If we were to implement atomics for SIMD types the APIs would look
// a lot like what we have for float64: most platforms do not have
// 16-byte (or wider) atomic operations, so the best native
// implementation would continue to require a coordination word.
//
// That said, the coordination word does not have to be a per-element
// parameter.  It could be a per-shared-region value, attached to the
// underlying SharedArrayBuffer, or it could be a value that is for a
// sub-region of such a shared region, in the form of an array of
// coordination values attached to the underlying SharedArrayBuffer.
// Both solutions will have higher contention and worse performance in
// some scenarios, than the current solution.
//
// It would probably be better for the Atomics object to provide
// atomic access to float64 (and SIMD data) with a hidden coordination
// word and with the understanding that it may sometimes be possible
// to optimize the code by providing an explicit coordination word, as
// here.  I will work toward having that implemented.

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

// TODO: Would these be better off as methods on SharedFloat64Array,
// eg, a.atomicLoad(fidx, iab, iidx)?  The reason I made them
// methods on Atomics is that once they become natively implemented
// that's where they'd most likely go.

if (!Atomics.hasOwnProperty("NUMF64INTS")) {

    // If NUMF64INTS is zero then any values can be passed for the
    // iab/iidx arguments to all these functions, those arguments will
    // not be used.  This being Javascript, and those arguments being
    // last in the parameter lists, they can simply be omitted
    // altogether (though the JIT will be happier if explicit values
    // are passed).

    Atomics.NUMF64INTS = 1;

    // Atomically load fab[fidx] and return it.

    Atomics.float64Load = function (fab, fidx, iab, iidx) {
	while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
	    ;
	try {
	    var v = fab[fidx];
	}
	finally {
	    Atomics.store(iab, iidx, 0);
	}
	return v;
    };

    // Atomically store v in fab[fidx].  Returns v.

    Atomics.float64Store = function (fab, fidx, v, iab, iidx) {
	while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
	    ;
	try {
	    fab[fidx] = v;
	}
	finally {
	    Atomics.store(iab, iidx, 0);
	}
	return v;
    };

    // Atomically compareExchange fab[fidx]: if its value is expected
    // then replace it with updated.  Returns the old value in the
    // cell.

    Atomics.float64CompareExchange = function (fab, fidx, expected, update, iab, iidx) {
	while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
	    ;
	try {
	    var v = fab[fidx];
	    if (v == expected)
		fab[fidx] = updated;
	}
	finally {
	    Atomics.store(iab, iidx, 0);
	}
	return v;
    };

    // Atomically add v to fab[fidx].  Returns the old value in the cell.

    Atomics.float64Add = function (fab, fidx, v, iab, iidx) {
	while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
	    ;
	try {
	    var w = fab[fidx];
	    fab[fidx] += v;
	}
	finally {
	    Atomics.store(iab, iidx, 0);
	}
	return w;
    };

    // Atomically subtract v from fab[fidx].  Returns the old value in
    // the cell.

    Atomics.float64Sub = function (fab, fidx, v, iab, iidx) {
	while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
	    ;
	try {
	    var w = fab[fidx];
	    fab[fidx] -= v;
	}
	finally {
	    Atomics.store(iab, iidx, 0);
	}
	return w;
    };
}

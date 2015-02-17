/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Atomic operations on int64 arrays.
//
// This polyfill provides these operations:
//
//   Atomics.int64Load
//   Atomics.int64Store
//   Atomics.int64CompareExchange
//   Atomics.int64Add
//   Atomics.int64Sub
//   Atomics.int64And
//   Atomics.int64Or
//   Atomics.int64Xor
//
// and this utility:
//
//   Atomics.int64HighBits
//
// An int64 value is represented as two int32 values.  On input, they
// are passed as two parameters, high and low in that order.  On
// output, the atomic ops return the low part of the result and stash
// the high part of the result, which can be retrieved with
// Atomics.int64HighBits().  The intent is that the JIT will be able
// to optimize the latter operation and remove most overhead, and we
// will not pay for an object allocation, and we will be able to use
// (eventual) native operations within asm.js code.
//
// An int64 array is represented as an int32 array of even length.  A
// valid index into an int64 array is always even.
//
// In the paragraphs above, "int32" always means "int32 exclusively",
// never "int32 or uint32".
//
// Common to all these methods is that they take an additional
// SharedInt32Array and index within that array, and *may* use the
// word(s) at that index (Atomics.NUMI64INTS words) for coordination.
// The words should initially be zero.
//
// In the polyfill, if an operation throws then the coordination word
// is left in a state where it will not impede progress of other
// accessing threads.  Each data word may or may not be updated
// however.  (A native implementation will likely do better.)

// Implementation note: We're assuming little endian for now.

if (!Atomics.hasOwnProperty("NUMI64INTS")) {

    Atomics.NUMI64INTS = 1;

    // Private; implementation artifact.  In the implementation this
    // may be a hidden field on the global object or ideally on
    // something that can be written in about one instruction.

    Atomics._stash = 0;

    // Atomically load (hi,lo) from lab[lidx].  Stash hi and return lo.

    Atomics.int64Load = function (lab, lidx, iab, iidx) {
	while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
	    ;
	try {
	    var lo = lab[lidx];
	    var hi = lab[lidx+1];
	    Atomics._stash = hi;
	    return lo;
	}
	finally {
	    Atomics.store(iab, iidx, 0);
	}
    };

    // Return the most recent stashed value.

    Atomics.int64HighBits = function () {
	return Atomics._stash;
    }

    // Atomically store (hi,lo) at lab[lidx].  Returns nothing.

    Atomics.int64Store = function (lab, lidx, value_hi, value_lo, iab, iidx) {
	while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
	    ;
	try {
	    lab[lidx] = value_lo;
	    lab[lidx+1] = value_hi;
	}
	finally {
	    Atomics.store(iab, iidx, 0);
	}
    };

    // Atomically load (hi,lo) from lab[lidx] and compare to (expected_hi,expected_lo);
    // if equal, update lab[idx] with (update_hi,update_lo).  Stash hi and return lo.

    Atomics.int64CompareExchange = function (lab, lidx, expected_hi, expected_lo, update_hi, update_lo, iab, iidx) {
	while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
	    ;
	try {
	    var vlo = lab[lidx];
	    var vhi = lab[lidx+1];
	    if (vlo == expected_lo && vhi == expected_hi) {
		lab[lidx] = update_lo;
		lab[lidx+1] = update_hi;
	    }
	    Atomics._stash = vhi;
	    return vlo;
	}
	finally {
	    Atomics.store(iab, iidx, 0);
	}
    };

    // Atomically load (hi,lo) from lab[lidx]; let (r,s) = (hi,lo)+(value_hi,value_lo);
    // store (r,s) at lab[idx].  Stash hi and return lo.

    Atomics.int64Add = function (lab, lidx, value_hi, value_lo, iab, iidx) {
	while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
	    ;
	try {
	    var lo = lab[lidx];
	    var hi = lab[lidx+1];
	    var rlo = lo + value_lo;
	    lab[lidx] = rlo|0;
	    var carry = (lo ^ value_lo) < 0 || (rlo ^ lo) >= 0 ? 1 : 0;
	    var rhi = (hi + value_hi + carry)
	    lab[lidx+1] = rhi|0;
	    Atomics._stash = hi;
	    return lo;
	}
	finally {
	    Atomics.store(iab, iidx, 0);
	}
    };

    // Atomically load (hi,lo) from lab[lidx]; let (r,s) = (hi,lo)-(value_hi,value_lo);
    // store (r,s) at lab[idx].  Stash hi and return lo.

    Atomics.int64Sub = function (lab, lidx, value_hi, value_lo, iab, iidx) {
	while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
	    ;
	try {
	    var lo = lab[lidx];
	    var hi = lab[lidx+1];
	    var rlo = lo - value_lo;
	    lab[lidx] = rlo|0;
	    var borrow = (lo ^ value_lo) >= 0 || (rlo ^ lo) >= 0 ? 1 : 0;
	    var rhi = hi - value_hi - borrow;
	    lab[lidx+1] = rhi|0;
	    Atomics._stash = hi;
	    return lo;
	}
	finally {
	    Atomics.store(iab, iidx, 0);
	}
    };

    // Atomically load (hi,lo) from lab[lidx]; let (r,s) = (hi,lo) & (value_hi,value_lo);
    // store (r,s) at lab[idx].  Stash hi and return lo.

    Atomics.int64And = function (lab, lidx, value_hi, value_lo, iab, iidx) {
	while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
	    ;
	try {
	    var lo = lab[lidx];
	    var hi = lab[lidx+1];
	    lab[lidx] = lo & value_lo;
	    lab[lidx+1] = hi & value_hi;
	    Atomics._stash = hi;
	    return lo;
	}
	finally {
	    Atomics.store(iab, iidx, 0);
	}
    };

    // Atomically load (hi,lo) from lab[lidx]; let (r,s) = (hi,lo) | (value_hi,value_lo);
    // store (r,s) at lab[idx].  Stash hi and return lo.

    Atomics.int64Or = function (lab, lidx, value_hi, value_lo, iab, iidx) {
	while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
	    ;
	try {
	    var lo = lab[lidx];
	    var hi = lab[lidx+1];
	    lab[lidx] = lo | value_lo;
	    lab[lidx+1] = hi | value_hi;
	    Atomics._stash = hi;
	    return lo;
	}
	finally {
	    Atomics.store(iab, iidx, 0);
	}
    };

    // Atomically load (hi,lo) from lab[lidx]; let (r,s) = (hi,lo) ^ (value_hi,value_lo);
    // store (r,s) at lab[idx].  Stash hi and return lo.

    Atomics.int64Xor = function (lab, lidx, value_hi, value_lo, iab, iidx) {
	while (Atomics.compareExchange(iab, iidx, 0, -1) != 0)
	    ;
	try {
	    var lo = lab[lidx];
	    var hi = lab[lidx+1];
	    lab[lidx] = lo ^ value_lo;
	    lab[lidx+1] = hi ^ value_hi;
	    Atomics._stash = hi;
	    return lo;
	}
	finally {
	    Atomics.store(iab, iidx, 0);
	}
    };
}

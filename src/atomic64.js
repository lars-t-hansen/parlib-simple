/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


// Note here that the scratch memory (hiOffset) must be per-thread.
// That's probably a significant complication in practice.

// Load (hi,lo) atomically from sab @ offset, store hi in sab @ hiOffset and return lo.

Atomics.load64 = function (sab, offset, hiOffset) {
    assert(u8 instanceof SharedArrayBuffer);
    assert(offset%8 == 0);
    assert(0 <= offset && offset+8 <= sab.byteLength);
    assert(hiOffset%4 == 0);
    assert(0 <= hiOffset && hiOffset+4 <= sab.byteLength);
    ...
}

// Store (hi,lo) atomically in sab @ outputIndex*8.

Atomics.store64 = function (sab, offset, hi, lo) {
    assert(u8 instance SharedUint8Array);
    assert((outputIndex+1)*8 <= u8.length);
    assert((valueIndex+1)*8 <= u8.length);
    ...
}

// If sab @ offset contains (oldHi,oldLo) then store (newHi,newLo).
// Return a {cellHi, cellLo} object.

Atomics.compareExchange64 = function (u8, cellIndex, oldvalIndex, newvalIndex, outputIndex) {
    assert(u8 instance SharedUint8Array);
    assert((cellIndex+1)*8 <= u8.length);
    assert((oldvalIndex+1)*8 <= u8.length);
    assert((newvalIndex+1)*8 <= u8.length);
    assert((outputIndex+1)*8 <= u8.length);
    ...
}


// Convenience wrappers for plain JS.  These will assume that four
// bytes in sab @ 0 are available for scratch memory.  (Bad, needs to be per-thread.)

// Load atomically from sab @ offset, return a {hi,lo} object.

Atomics.load32x2 = function (sab, offset) {
    assert(u8 instanceof SharedArrayBuffer);
    assert(offset%8 == 0);
    assert(offset+8 <= sab.byteLength);
    ...
}

// Store (hi,lo) atomically in sab @ outputIndex*8.

Atomics.store32x2 = function (sab, offset, hi, lo) {
    assert(u8 instanceof SharedArrayBuffer);
    assert(offset%8 == 0);
    assert(offset+8 <= sab.byteLength);
    ...
}

// If sab @ offset contains (oldHi,oldLo) then store (newHi,newLo).
// Return a {cellHi, cellLo} object.

Atomics.compareExchange32x2 = function (sab, offset, oldHi, oldLo, newHi, newLo) {
    assert(u8 instanceof SharedArrayBuffer);
    assert(offset%8 == 0);
    assert(offset+8 <= sab.byteLength);
    ...
}



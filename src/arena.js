/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * A very simple allocator for bump-allocation within a SharedArrayBuffer
 * or ArrayBuffer, with integrated alignment management.
 */

"use strict";

/*
 * Construct the arena.
 *
 * ab must be an ArrayBuffer or SharedArrayBuffer.
 * offset must be a valid index within ab.
 * length must be a nonnegative integer.
 * offset + length - 1 must be a valid index within ab.
 */
function ArrayBufferArena(ab, offset, length) {
    if (!((ab instanceof SharedArrayBuffer || ab instanceof ArrayBuffer) &&
	  (offset|0) === offset &&
	  offset >= 0 && offset < ab.byteLength &&
	  (length|0) === length &&
	  length >= 0 && offset + length <= ab.byteLength))
    {
	throw new Error("Bad arena parameters: " + ab + " " + offset + " " + length);
    }
    this._ab = ab;
    this._offset = offset;
    this._limit = offset + length;
}

/*
 * Returns the underlying buffer.
 */
Object.defineProperty(ArrayBufferArena.prototype,
		      "buffer",
		      { get: function () { return this._ab } });

/*
 * Allocate nbytes, aligned on "align" bytes (not optional) within the buffer.
 * Returns the offset within the buffer of the newly allocated area.
 * Throws an Error on heap overflow.
 */
ArrayBufferArena.prototype.alloc = function (nbytes, align) {
    var p = this._alignPtr(align);
    if (p + nbytes <= this._limit) {
	this._offset = p + nbytes;
	return p;
    }
    throw new Error("ArrayBufferArena exhausted");
}

/*
 * Compute the amount of space that would be available to an allocation
 * aligned on "align" bytes (not optional).
 * Returns that amount.
 */
ArrayBufferArena.prototype.available = function (align) {
    var p = this._alignPtr(align);
    return Math.max(this._limit - p, 0);
}

// Internal methods beyond this point.

ArrayBufferArena.prototype._alignPtr = function (align) {
    if ((align|0) !== align || align < 0)
	throw new Error("Bad alignment: " + align)
    return Math.floor((this._offset + (align - 1)) / align) * align;
}

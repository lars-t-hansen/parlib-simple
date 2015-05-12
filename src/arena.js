/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Simple non-shared bump-allocating arena.  Handles alignment and
 * allocation pointer/limit management in a SharedArrayBuffer.
 */


// TODO: Rename as SABArena?  And why limit to SAB?  An ArrayBuffer would
// work just as well.  It could just be ArrayBufferArena.
// If changing that, be sure to push type test for SAB into clients.

/*
 * Construct the arena.  sab must be a SharedArrayBuffer, offset must be
 * a valid index, offset + length - 1 must be a valid index, and length must
 * be nonnegative.
 */
function Arena(sab, offset, length) {
    if (!(sab instanceof SharedArrayBuffer &&
	  offset >= 0 && offset < sab.byteLength &&
	  length >= 0 && offset + length <= sab.byteLength))
    {
	throw new Error("Bad arena parameters: " + sab + " " + offset + " " + length);
    }
    this._sab = sab;
    this._offset = offset;
    this._limit = offset + length;
}

/*
 * Allocate nbytes, aligned on "align" (not optional).
 * Throw an error on overflow.
 * Return the offset within the sab of the newly allocated area.
 */
Arena.prototype.alloc = function (nbytes, align) {
    var p = this._alignPtr(align);
    if (p + nbytes <= this._limit) {
	this._offset = p + nbytes;
	return p;
    }
    throw new Error("Arena exhausted");
}

/*
 * Return the amount of space that would be available to an allocation
 * aligned on "align" (not optional).
 */
Arena.prototype.available = function (align) {
    var p = this._alignPtr(align);
    return Math.max(this._limit - p, 0);
}

// Internal methods beyond this point.

Arena.prototype._alignPtr = function (align) {
    if ((align|0) !== align || align < 0)
	throw new Error("Bad alignment: " + align)
    return Math.floor((this._offset + (align - 1)) / align) * align;
}

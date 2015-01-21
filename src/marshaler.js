/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A Marshaler is a utility object for transmitting values among
// agents through shared memory.
//
// The marshaler does not itself use shared memory, but encodes values
// and maintains state about shared arrays that have been seen
// previously.  Thus marshalers that are kept in sync across agents by
// registering shared arrays with them can be used to transmit shared
// arrays in addition to other data.
//
// The following data types are currently supported:
//
//  - null
//  - undefined
//  - boolean
//  - number
//  - string
//  - SharedArrayBuffer
//  - SharedTypedArray
//
// Only shared array types are passed by reference, all other types
// are copied.
//
// TODO:
// Support more data types: simd types; also plain objects, arrays,
// and typedarrays would be very helpful, at least for small
// non-self-referential objects; we could have an arbitrary cutoff
// (bleah) or a warning for large ones, and an error for circular
// ones.
//
// In general it may be useful to allow marshal to take an argument
// that is a function that can be used to filter.  Look to JSON?

"use strict";

// Construct a new marshaler.

function Marshaler() {
    var tmp = new ArrayBuffer(8);
    this._knownSAB = [];
    this._itmp = new Int32Array(tmp);
    this._ftmp = new Float64Array(tmp);
}

// Private tag values representing object types.

const _MARSHAL_I32 = 1;
const _MARSHAL_F64 = 2;
const _MARSHAL_SAB = 3;
const _MARSHAL_STA = 4;
const _MARSHAL_BOOL = 5;
const _MARSHAL_UNDEF = 6;
const _MARSHAL_NULL = 7;
const _MARSHAL_STRING = 8;

// Private tag values representing shared array types.

const _MARSHAL_TAG_SAB = 1;
const _MARSHAL_TAG_I8 = 2;
const _MARSHAL_TAG_U8 = 3;
const _MARSHAL_TAG_CU8 = 4;
const _MARSHAL_TAG_I16 = 5;
const _MARSHAL_TAG_U16 = 6;
const _MARSHAL_TAG_I32 = 7;
const _MARSHAL_TAG_U32 = 8;
const _MARSHAL_TAG_F32 = 9;
const _MARSHAL_TAG_F64 = 10;

// Given a dense array of JS values, return an object with two fields:
//
//  values is a dense Array of int32 values representing the
//    marshaled values.
//  newSAB is a dense Array of previously unknown SharedArrayBuffer
//    objects, along with their identifying integer numbers; these
//    shared objects will now have become known.  The Array elements
//    are objects with two fields, "sab" and "id".
//
// Client code must transmit any new SharedArrayBuffer objects along
// with their identifiers to other agents before unmarshaling values
// that reference those objects.  (Such transmission is only possible
// via the message loop.)
//
// SharedArrayBuffers (but not SharedTypedArrays) that are marshaled
// several times from the same marshaling object to the same
// unmarshaling object will unmarshal as identical objects.

Marshaler.prototype.marshal =
    function (values) {
	var argValues = [];
	var newSAB = [];
	var vno = 0;
	var self = this;

	values.forEach(pushArg)
	return { values: argValues, newSAB };

	function pushArg(v) {
	    if (+v === v) {
		if ((v|0) === v) {
		    argValues.push(_MARSHAL_I32);
		    argValues.push(v);
		}
		else {
		    argValues.push(_MARSHAL_F64);
		    self._ftmp[0] = v;
		    argValues.push(self._itmp[0]);
		    argValues.push(self._itmp[1]);
		}
		++vno;
		return;
	    }

	    if (v === undefined) {
		argValues.push(_MARSHAL_UNDEF);
		++vno;
		return;
	    }

	    if (v === null) {
		argValues.push(_MARSHAL_NULL);
		++vno;
		return;
	    }

	    if (v === true || v === false) {
		argValues.push(_MARSHAL_BOOL | (v ? 256 : 0));
		++vno;
		return;
	    }

	    if (typeof v == 'string') {
		// TODO: get rid of this limit
		if (v.length >= 0x1000000)
		    throw new Error("String too long to be marshalled");
		argValues.push(_MARSHAL_STRING | (v.length << 8));
		var i = 0;
		while (i < v.length) {
		    var k = v.charCodeAt(i++);
		    if (i < v.length)
			k |= (v.charCodeAt(i++) << 16);
		    argValues.push(k);
		}
		++vno;
		return;
	    }

	    if (v instanceof SharedArrayBuffer) {
		argValues.push(_MARSHAL_SAB);
		argValues.push(lookupOrRegisterSAB(v));
		++vno;
		return;
	    }

	    var tag = 0;
	    if (v instanceof SharedInt8Array)
		tag = _MARSHAL_TAG_I8;
	    else if (v instanceof SharedUint8Array)
		tag = _MARSHAL_TAG_U8;
	    else if (v instanceof SharedUint8ClampedArray)
		tag = _MARSHAL_TAG_CU8;
	    else if (v instanceof SharedInt16Array)
		tag = _MARSHAL_TAG_I16;
	    else if (v instanceof SharedUint16Array)
		tag = _MARSHAL_TAG_U16;
	    else if (v instanceof SharedInt32Array)
		tag = _MARSHAL_TAG_I32;
	    else if (v instanceof SharedUint32Array)
		tag = _MARSHAL_TAG_U32;
	    else if (v instanceof SharedFloat32Array)
		tag = _MARSHAL_TAG_F32;
	    else if (v instanceof SharedFloat64Array)
		tag = _MARSHAL_TAG_F64;
	    else
		throw new Error("Argument #" + vno + " is of unsupported type: " + v);

	    argValues.push(_MARSHAL_STA | (tag << 8));
	    argValues.push(lookupOrRegisterSAB(v.buffer));
	    argValues.push(v.byteOffset);
	    argValues.push(v.length);
	    ++vno;
	}

	function lookupOrRegisterSAB(sab) {
	    for ( var i=0 ; i < self._knownSAB.length ; i++ )
		if (self._knownSAB[i] === sab)
		    return i;
	    var id = self._knownSAB.length;
	    self._knownSAB.push(sab);
	    newSAB.push({sab, id});
	    return id;
	}
    };

// Register a SharedArrayBuffer along with its numeric ID.  Normally
// the SAB and the ID will have been received by postMessage from
// another agent, and the registration happens in preparation for
// unmarshaling data that will reference the SAB by that ID.
//
// There's no check here against a SAB operating under multiple IDs,
// as that is benign.

Marshaler.prototype.registerSAB =
    function (sab, id) {
	if (!(sab instanceof SharedArrayBuffer))
	    throw new Error("Not a SharedArrayBuffer: " + sab);
	if ((id|0) !== id)
	    throw new Error("Not a valid ID: " + id);
	if (this._knownSAB.hasOwnProperty(id)) {
	    if (this._knownSAB[id] === sab)
		return;
	    throw new Error("The ID " + id + " is already in use");
	}
	this._knownSAB[id] = sab;
	return id;
    };

// Get a SharedArrayBuffer given its ID, or null if there's no
// SharedArrayBuffer by that name.

Marshaler.prototype.getSAB =
    function (id) {
	if ((id|0) !== id)
	    throw new Error("Not a valid ID: " + id);
	if (this._knownSAB.hasOwnProperty(id))
	    return this._knownSAB[id];
	return null;
    };

// Given an array-like containing int32 values representing marshaled
// data, and a start index within that array, and a count of int32
// values to process, return a dense Array of JS values unmarshaled
// from the input array.
//
// Marshaled values representing shared data will be looked up in the
// 'this' object (see getSAB, above); if a shared object is not found
// an error is thrown.

Marshaler.prototype.unmarshal =
    function (M, index, count) {
	const args = [];
	const limit = index + count;
	const self = this;

	while (index < limit)
	    args.push(parseArg());

	return args;

	function parseArg() {
	    var tag = M[index++];
	    switch (tag & 255) {
	    case _MARSHAL_I32:
		check(1);
		return M[index++];
	    case _MARSHAL_F64:
		check(2);
		self._itmp[0] = M[index++];
		self._itmp[1] = M[index++];
		return self._ftmp[0];
	    case _MARSHAL_SAB:
		check(1);
		var sab = self._knownSAB[M[index++]];
		if (!sab)
		    throw new Error("Unknown (unregistered?) SharedArrayBuffer in unmarshaling");
		return sab;
	    case _MARSHAL_STA:
		check(3);
		var sab = self._knownSAB[M[index++]];
		if (!sab)
		    throw new Error("Unknown (unregistered?) SharedArrayBuffer for SharedTypedArray in unmarshaling");
		var byteOffset = M[index++];
		var length = M[index++];
		switch (tag >> 8) {
		case _MARSHAL_TAG_I8:  return new SharedInt8Array(sab, byteOffset, length);
		case _MARSHAL_TAG_U8:  return new SharedUint8Array(sab, byteOffset, length);
		case _MARSHAL_TAG_CU8: return new SharedUint8ClampedArray(sab, byteOffset, length);
		case _MARSHAL_TAG_I16: return new SharedInt16Array(sab, byteOffset, length);
		case _MARSHAL_TAG_U16: return new SharedUint16Array(sab, byteOffset, length);
		case _MARSHAL_TAG_I32: return new SharedInt32Array(sab, byteOffset, length);
		case _MARSHAL_TAG_U32: return new SharedUint32Array(sab, byteOffset, length);
		case _MARSHAL_TAG_F32: return new SharedFloat32Array(sab, byteOffset, length);
		case _MARSHAL_TAG_F64: return new SharedFloat64Array(sab, byteOffset, length);
		default: throw new Error("Bad array typetag: " + (tag >> 8).toString(16));
		}
	    case _MARSHAL_BOOL:
		return !!(tag >> 8);
	    case _MARSHAL_UNDEF:
		return undefined;
	    case _MARSHAL_NULL:
		return null;
	    case _MARSHAL_STRING:
		var len = (tag >>> 8);
		var i = 0;
		var s = "";
		check(Math.ceil(len / 2));
		while (i < len) {
		    var w = M[index++];
		    s += String.fromCharCode(w & 0xFFFF);
		    i++;
		    if (i == len)
			break;
		    s += String.fromCharCode(w >>> 16);
		    i++;
		}
		return s;
	    default:
		throw new Error("Bad data tag: " + tag);
	    }
	}

	function check(n) {
	    if (index+n > limit)
		throw new Error("Out-of-bounds reference in marshaled data at location " + index + "; need " + n + ", have " + (limit-index));
	}
    };

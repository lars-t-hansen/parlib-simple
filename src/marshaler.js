/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A Marshaler is a utility type for flattening and reconstituting
// values, to allow them to be transmitted through shared memory.
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
//  - TypedArray on ArrayBuffer and SharedArrayBuffer
//  - Array
//  - ArrayBuffer
//  - TypedArray
//  - Objects
//
// Only shared array types are passed by reference, all other types
// are copied.
//
// Sharing for copied types is not honored, and if a copied datum is
// marshaled twice it is unmarshaled as two distinct objects.
//
// Holes in arrays are preserved but very sparse arrays are not (yet)
// handled well, one value is transmitted per element in the range of
// the array.
//
// For objects, all enumerable non-function-valued 'own' properties
// are transmitted but prototype objects are not and prototype
// relationships are lost.
//
// The marshaler is extensible, as follows.
//
// An object value's toMarshaled() method, if present, will be invoked
// with the marshaler as its argument, and must return an array of
// integer values representing the marshaled value.  (Recursive
// invocations of the marshaler's marshal() method will return an
// empty newSAB value, which can be ignored.)  The first value of that
// array must be a unique identifying tag.
//
// The tag is created by calling Marshaler.generateID() in one agent
// and registered in other agents by calling Marshaler.registerID() in
// others.
//
// When a tag is created or registered it can be associated with an
// unmarshaler function.  When an object with that tag is to be
// unmarshaled the registered handler will be invoked on the
// unmarshaler object and on an array containing the same integer
// values (including the tag) that were returned from the marshaling.

"use strict";

// Construct a new marshaler.

function Marshaler() {
    var tmp = new ArrayBuffer(8);

    // Known SharedArrayBuffers: a SAB with ID i is at element i in
    // this array.  The array is not necessarily dense.
    this._knownSAB = [];

    // New SharedArrayBuffers being seen during a possibly recursive
    // invocation of the marshaler.  This holds {sab,id} objects.  A
    // given sab appears at most once in the list, and when it does,
    // _knownSAB[id] == sab.
    this._newSAB = [];

    // Temps for serializing / deserializing floats.
    this._itmp = new Int32Array(tmp);
    this._ftmp = new Float64Array(tmp);

    // Custom tags (for toMarshaled) have bit 7 set, and a subtag in
    // bits 8-31.  _nextID is the next value of that subtag.  The
    // range of subtags is not necessarily dense.
    this._nextID = 256;

    // Map from string IDs to custom tags.
    this._ids = {};

    // Map from custom tags to functions or null/undefined.
    this._handlers = {};

    // Reentrancy counter for the marshaler.
    this._counter = 0;
}

// Private tag values representing object types.

const _MARSHAL_I32    = 1;
const _MARSHAL_F64    = 2;
const _MARSHAL_SAB    = 3;
const _MARSHAL_STA    = 4;
const _MARSHAL_BOOL   = 5;
const _MARSHAL_UNDEF  = 6;
const _MARSHAL_NULL   = 7;
const _MARSHAL_STRING = 8;
const _MARSHAL_OBJECT = 9;
const _MARSHAL_ARRAY  = 10;
const _MARSHAL_TA     = 11;
const _MARSHAL_AB     = 12;
const _MARSHAL_HOLE   = 13;

// Private tag values representing shared and unshared array types.

const _MARSHAL_TAG_I8  = 1;
const _MARSHAL_TAG_U8  = 2;
const _MARSHAL_TAG_CU8 = 3;
const _MARSHAL_TAG_I16 = 4;
const _MARSHAL_TAG_U16 = 5;
const _MARSHAL_TAG_I32 = 6;
const _MARSHAL_TAG_U32 = 7;
const _MARSHAL_TAG_F32 = 8;
const _MARSHAL_TAG_F64 = 9;

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
// SharedArrayBuffers that are marshaled several times from the same
// marshaling object to the same unmarshaling object will unmarshal as
// identical objects.
//
// The array of int32 values has no header: two such arrays can be
// catenated and still represent a valid sequence of marshaled values.

Marshaler.prototype.marshal =
    function (values) {
	var argValues = [];
	var vno = 0;
	var self = this;

	try {
	    var newSAB = [];
	    if (this._counter == 0)
		this._newSAB = newSAB;
	    this._counter++;

	    values.forEach(pushValue)
	    return { values: argValues, newSAB };
	}
	finally {
	    this._counter--;
	}

	function pushValue(v) {
	    pushArg(v);
	    vno++;
	}

	function pushArg(v) {
	    if (typeof v == 'number') {
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
		return;
	    }

	    if (v === undefined) {
		argValues.push(_MARSHAL_UNDEF);
		return;
	    }

	    if (v === null) {
		argValues.push(_MARSHAL_NULL);
		return;
	    }

	    if (v === true || v === false) {
		argValues.push(_MARSHAL_BOOL | (v ? 256 : 0));
		return;
	    }

	    if (typeof v == 'string') {
		argValues.push(_MARSHAL_STRING);
		argValues.push(v.length);
		var i = 0;
		while (i < v.length) {
		    var k = v.charCodeAt(i++);
		    if (i < v.length)
			k |= (v.charCodeAt(i++) << 16);
		    argValues.push(k);
		}
		return;
	    }

	    if ((typeof v == 'object' || typeof v == 'function') && typeof v.toMarshaled == 'function') {
		var values = v.toMarshaled(self);
		if (!(Array.isArray(values) && self._handlers.hasOwnProperty(values[0])))
		    throw new Error("toMarshaled did not return a valid encoding for " + v);
		argValues.push(values[0]);
		argValues.push(values.length-1);
		for ( var i=1 ; i < values.length ; i++ )
		    argValues.push(values[i]);
		return;
	    }

	    var header = 0;
	    if (v instanceof Int8Array)
		header = (_MARSHAL_TAG_I8 << 8) | _MARSHAL_TA;
	    else if (v instanceof Uint8Array)
		header = (_MARSHAL_TAG_U8 << 8) | _MARSHAL_TA;
	    else if (v instanceof Uint8ClampedArray)
		header = (_MARSHAL_TAG_CU8 << 8) | _MARSHAL_TA;
	    else if (v instanceof Int16Array)
		header = (_MARSHAL_TAG_I16 << 8) | _MARSHAL_TA;
	    else if (v instanceof Uint16Array)
		header = (_MARSHAL_TAG_U16 << 8) | _MARSHAL_TA;
	    else if (v instanceof Int32Array)
		header = (_MARSHAL_TAG_I32 << 8) | _MARSHAL_TA;
	    else if (v instanceof Uint32Array)
		header = (_MARSHAL_TAG_U32 << 8) | _MARSHAL_TA;
	    else if (v instanceof Float32Array)
		header = (_MARSHAL_TAG_F32 << 8) | _MARSHAL_TA;
	    else if (v instanceof Float64Array)
		header = (_MARSHAL_TAG_F64 << 8) | _MARSHAL_TA;

	    // TA on SharedArrayBuffer is handled below, for the time being.

	    if (v instanceof ArrayBuffer || (header != 0 && !(v.buffer instanceof SharedArrayBuffer))) {
		// One can optimize this if the payload length is
		// divisible by 4 and starts on a 4-byte boundary.
		var tmp;
		if (header != 0) {
		    argValues.push(header);
		    argValues.push(v.length * v.BYTES_PER_ELEMENT);
		    tmp = new Uint8Array(v.buffer, v.byteOffset, v.length * v.BYTES_PER_ELEMENT);
		}
		else {
		    argValues.push(_MARSHAL_AB);
		    argValues.push(v.byteLength);
		    tmp = new Uint8Array(v);
		}
		for ( var i=0, lim=tmp.length & ~3 ; i < lim ; i += 4) {
		    var x = (tmp[i] << 24) | (tmp[i+1] << 16) | (tmp[i+2] << 8) | tmp[i+3];
		    argValues.push(x);
		}
		if (i < tmp.length) {
		    var x = 0;
		    for ( ; i < tmp.length ; i++ )
			x = (x << 8) | tmp[i];
		    argValues.push(x);
		}
		return;
	    }

	    if (v instanceof SharedArrayBuffer) {
		argValues.push(_MARSHAL_SAB);
		argValues.push(lookupOrRegisterSAB(v));
		return;
	    }

	    // This handles TA on SharedArrayBuffer, TA on ArrayBuffer was handled above.

	    var header = 0;
	    if (v instanceof Int8Array)
		header = (_MARSHAL_TAG_I8 << 8) | _MARSHAL_STA;
	    else if (v instanceof Uint8Array)
		header = (_MARSHAL_TAG_U8 << 8) | _MARSHAL_STA;
	    else if (v instanceof Uint8ClampedArray)
		header = (_MARSHAL_TAG_CU8 << 8) | _MARSHAL_STA;
	    else if (v instanceof Int16Array)
		header = (_MARSHAL_TAG_I16 << 8) | _MARSHAL_STA;
	    else if (v instanceof Uint16Array)
		header = (_MARSHAL_TAG_U16 << 8) | _MARSHAL_STA;
	    else if (v instanceof Int32Array)
		header = (_MARSHAL_TAG_I32 << 8) | _MARSHAL_STA;
	    else if (v instanceof Uint32Array)
		header = (_MARSHAL_TAG_U32 << 8) | _MARSHAL_STA;
	    else if (v instanceof Float32Array)
		header = (_MARSHAL_TAG_F32 << 8) | _MARSHAL_STA;
	    else if (v instanceof Float64Array)
		header = (_MARSHAL_TAG_F64 << 8) | _MARSHAL_STA;

	    if (header != 0) {
		argValues.push(header);
		argValues.push(lookupOrRegisterSAB(v.buffer));
		argValues.push(v.byteOffset);
		argValues.push(v.length);
		return;
	    }

	    if (Array.isArray(v)) {
		argValues.push(_MARSHAL_ARRAY);
		argValues.push(v.length);
		for ( var i=0 ; i < v.length ; i++ ) {
		    if (v.hasOwnProperty(i))
			pushArg(v[i]);
		    else
			argValues.push(_MARSHAL_HOLE);
		}
		return;
	    }

	    if (typeof v == 'object') {
		argValues.push(_MARSHAL_OBJECT);
		var keys = [];
		var values = [];
		for ( var k in v ) {
		    if (v.hasOwnProperty(k)) {
			var val = v[k];
			if (typeof val != 'function') {
			    keys.push(k);
			    values.push(val);
			}
		    }
		}
		argValues.push(keys.length);
		for ( var i=0 ; i < keys.length ; i++ ) {
		    pushArg(keys[i]);
		    pushArg(values[i]);
		}
		return;
	    }

	    throw new Error("Argument #" + vno + " is of unsupported type: " + v);
	}

	function lookupOrRegisterSAB(sab) {
	    for ( var i=0 ; i < self._knownSAB.length ; i++ )
		if (self._knownSAB[i] === sab)
		    return i;
	    var id = self._knownSAB.length;
	    self._knownSAB.push(sab);
	    self._newSAB.push({sab, id});
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
	    case _MARSHAL_AB:
	    case _MARSHAL_TA:
		check(1);
		var bytelen = M[index++];
		var ab = new ArrayBuffer(bytelen);
		check(Math.ceil(bytelen/4));
		var tmp = new Uint8Array(ab);
		for ( var i=0, lim=bytelen & ~3 ; i < lim ; i+= 4 ) {
		    var x = M[index++];
		    tmp[i+3] = x; x >>= 8;
		    tmp[i+2] = x; x >>= 8;
		    tmp[i+1] = x; x >>= 8;
		    tmp[i+0] = x; x >>= 8;
		}
		if (bytelen & 3) {
		    var x = M[index++];
		    var k = bytelen & 3;
		    while (k-- > 0) {
			tmp[i+k] = x;
			x >>= 8;
		    }
		}
		if (tag == _MARSHAL_AB)
		    return ab;
		switch (tag >> 8) {
		case _MARSHAL_TAG_I8:  return new Int8Array(ab);
		case _MARSHAL_TAG_U8:  return tmp;
		case _MARSHAL_TAG_CU8: return new Uint8ClampedArray(ab);
		case _MARSHAL_TAG_I16: return new Int16Array(ab);
		case _MARSHAL_TAG_U16: return new Uint16Array(ab);
		case _MARSHAL_TAG_I32: return new Int32Array(ab);
		case _MARSHAL_TAG_U32: return new Uint32Array(ab);
		case _MARSHAL_TAG_F32: return new Float32Array(ab);
		case _MARSHAL_TAG_F64: return new Float64Array(ab);
		default: throw new Error("Bad TypedArray typetag: " + (tag >> 8).toString(16));
		}
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
		    throw new Error("Unknown (unregistered?) SharedArrayBuffer for TypedArray in unmarshaling");
		var byteOffset = M[index++];
		var length = M[index++];
		switch (tag >> 8) {
		case _MARSHAL_TAG_I8:  return new Int8Array(sab, byteOffset, length);
		case _MARSHAL_TAG_U8:  return new Uint8Array(sab, byteOffset, length);
		case _MARSHAL_TAG_CU8: return new Uint8ClampedArray(sab, byteOffset, length);
		case _MARSHAL_TAG_I16: return new Int16Array(sab, byteOffset, length);
		case _MARSHAL_TAG_U16: return new Uint16Array(sab, byteOffset, length);
		case _MARSHAL_TAG_I32: return new Int32Array(sab, byteOffset, length);
		case _MARSHAL_TAG_U32: return new Uint32Array(sab, byteOffset, length);
		case _MARSHAL_TAG_F32: return new Float32Array(sab, byteOffset, length);
		case _MARSHAL_TAG_F64: return new Float64Array(sab, byteOffset, length);
		default: throw new Error("Bad TypedArray typetag: " + (tag >> 8).toString(16));
		}
	    case _MARSHAL_BOOL:
		return !!(tag >> 8);
	    case _MARSHAL_UNDEF:
		return undefined;
	    case _MARSHAL_NULL:
		return null;
	    case _MARSHAL_STRING:
		check(1);
		var len = M[index++];
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
	    case _MARSHAL_ARRAY:
		check(1);
		var len = M[index++];
		var a = new Array(len);
		for ( var i=0 ; i < len ; i++ ) {
		    check(1);
		    if (M[index] == _MARSHAL_HOLE)
			index++;
		    else
			a[i] = parseArg();
		}
		return a;
	    case _MARSHAL_OBJECT:
		check(1);
		var numprops = M[index++];
		var o = {};
		for ( var i=0 ; i < numprops ; i++ ) {
		    check(1);
		    var key = parseArg();
		    check(1);
		    var value = parseArg();
		    o[key] = value;
		}
		return o;
	    default:
		if (self._handlers[tag]) {
		    check(1);
		    var numvalues = M[index++];
		    check(numvalues);
		    var vals = [tag];
		    for ( var i=0 ; i < numvalues ; i++ )
			vals.push(M[index++]);
		    return self._handlers[tag](self, vals);
		}

		if (self._handlers.hasOwnProperty(tag))
		    throw new Error("No unmarshaler registered for type " + self._id[tag]);

		throw new Error("Bad data tag: " + tag);
	    }
	}

	function check(n) {
	    if (index+n > limit)
		throw new Error("Out-of-bounds reference in marshaled data at location " + index + "; need " + n + ", have " + (limit-index));
	}
    };

// Generate a new ID for custom marshaling.  The tag (a string) is
// used for information only, but must be globally unique.  ID
// generation is not coordinated globally however; the agent must
// itself transmit IDs and tags to other agents for registration.
//
// The handler is null/undefined or a function.  If null/undefined,
// then this agent will not be able to receive objects encoded with
// the generated ID.

Marshaler.prototype.generateID =
    function (tag, handler) {
	if (this._ids.hasOwnProperty(tag))
	    throw new Error("The marshaling tag " + tag + " is already known.");
	var id = (this._nextID++ | 128);
	if (this._handlers[id])
	    throw new Error("The marshaling ID " + id + " is already known (should not happen).");
	this._ids[tag] = id;
	this._handlers[id] = handler;
	return id;
    };

// Register an existing ID for custom marshaling.  See above.

Marshaler.prototype.registerID =
    function (tag, id, handler) {
	if (this._ids.hasOwnProperty(tag))
	    throw new Error("The marshaling tag " + tag + " is already known.");
	if (this._handlers[id])
	    throw new Error("The marshaling ID " + id + " is already known.");
	this._ids[tag] = id;
	this._handlers[id] = handler;
	if ((id & ~128) > this._nextID)
	    this._nextID = (id & ~128);
    };

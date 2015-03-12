/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* A "Synchronic" object represents an atomic cell as a JS object with
 * methods that can block waiting for the cell to change value.
 *
 * For motivation, see:
 * http://www.open-std.org/jtc1/sc22/wg21/docs/papers/2014/n4195.pdf
 * https://code.google.com/p/synchronic/
 */

/* Synchronic API
 * --------------
 *
 * The Synchronic constructors are type specific.  To construct a
 * Synchronic Int32 object do:
 *
 *   new SynchronicInt32(sab, index, initialize=false)
 *
 * where "sab" is a SharedArrayBuffer, "index" is a byte index within
 * sab that is divisible by (in this case) SynchronicInt32.NUMBYTES,
 * and "initialize" should be true for the first caller that creates
 * the Synchronic object on that particular area of memory.  That
 * first call must return before any constructor calls on that memory
 * in other threads may start.
 *
 * (Similarly for Int8, Uint8, Int16, Uint16, Uint32, Float32, and
 * Float64.)
 *
 * Each constructor function has a property NUMBYTES, which denotes
 * the number of bytes in the SharedArrayBuffer that must be reserved
 * for a Synchronic of the given type.  This value includes any
 * padding and control words; the memory required for an array of
 * Synchronic objects is thus the length of the array times the
 * NUMBYTES value for the base type.
 *
 * All Synchronic objects have the following value manipulation
 * methods (all are atomic and mirror their counterparts on the
 * Atomics object):
 *
 * - load() retrieves the current value of the object
 * - store(v) stores v in the object
 * - compareExchange(o, n) stores n in the object if its current value is o
 * - add(v) adds v to the object and returns the old value
 * - sub(v) subtracts v from the object and returns the old value
 * - exchange(v) stores v in the object and returns the old value
 *
 * Integer objects additionally have these methods:
 *
 * - and(v) bitwise-ands v into the object and returns the old value
 * - or(v) bitwise-ors v into the object and returns the old value
 * - xor(v) bitwise-xors v into the object and returns the old value
 *
 * Finally, objects have methods that wait:
 *
 * - loadWhenEqual(x) waits until the value in the object is x, it returns x
 * - loadWhenNotEqual(x) waits until the value in the object is not x, it
 *   returns the value in the object
 *
 * The methods that store values in the object will wake threads that
 * are waiting in loadWhenEqual / loadWhenNotEqual as appropriate.
 */

const _Synchronic_floating_methods =
{
    load: function () {
	return Atomics.load(this._ta, this._taIdx);
    },

    store: function (value) {
	Atomics.store(this._ta, this._taIdx, value);
	this._notify();
    },

    compareExchange: function (oldval, newval) {
	// TODO
	throw new Error("compareExchange not implemented");
    },

    add: function (value) {
	var v;
	for (;;) {
	    v = Atomics.load(this._ta, this._taIdx);
	    var w = v + value;
	    var x = Atomics.compareExchange(this._ta, this._taIdx, v, w);
	    // TODO: Issues around +0 / -0?
	    if (x == v || isNaN(x) && isNaN(v))
		break;
	}
	this._notify();
	return v;
    },

    sub: function (value) {
	var v;
	for (;;) {
	    v = Atomics.load(this._ta, this._taIdx);
	    var w = v - value;
	    var x = Atomics.compareExchange(this._ta, this._taIdx, v, w);
	    // TODO: Issues around +0 / -0?
	    if (x == v || isNaN(x) && isNaN(v))
		break;
	}
	this._notify();
	return v;
    },

    exchange: function (value) {
	// TODO
	throw new Error("exchange not implemented");
    },

    loadWhenEqual: function (value) {
	var v;
	while ((v = Atomics.load(this._ta, this._taIdx)) != value)
	    this._expectUpdate(v);
	return value;
    },

    loadWhenNotEqual: function (value) {
	var v;
	while ((v = Atomics.load(this._ta, this._taIdx)) == value)
	    this._expectUpdate(value);
	return v;
    },

    // Not sure how good this is.  Do we need an add before and another after?
    // Probably want some kind of seqlock, which is more elaborate.

    _expectUpdate: function (currentValue) {
	if (isNaN(currentValue)) {
	    for (;;) {
		var seq = Atomics.load(this._ia, this._seqIdx);
		if (!isNaN(Atomics.load(this._ta, this._taIdx)))
		    break;
		Atomics.futexWait(this._ia, this._seqIdx, seq, Number.POSITIVE_INFINITY);
	    }
	}
	else {
	    for (;;) {
		var seq = Atomics.load(this._ia, this._seqIdx);
		if (Atomics.load(this._ta, this._taIdx) != currentValue)
		    break;
		Atomics.futexWait(this._ia, this._seqIdx, seq, Number.POSITIVE_INFINITY);
	    }
	}
    },

    _notify: function () {
	Atomics.add(this._ia, this._seq, 1);
	Atomics.futexWake(this._ia, this._val, Number.POSITIVE_INFINITY);
    }
};

// For integer types we use a single int32 cell for the value.  For
// byte and halfword the value is arranged in the low half of the
// int32.

const _Synchronic_int_methods =
{
    load: function () {
	return Atomics.load(this._ta, this._taIdx);
    },

    store: function (value) {
	Atomics.store(this._ta, this._taIdx, value);
	this._notify();
    },

    compareExchange: function (oldval, newval) {
	// TODO
	throw new Error("compareExchange not implemented");
    },

    add: function (value) {
	const v = Atomics.add(this._ta, this._taIdx, value);
	this._notify();
	return v;
    },

    sub: function (value) {
	const v = Atomics.sub(this._ta, this._taIdx, value);
	this._notify();
	return v;
    },

    and: function (value) {
	const v = Atomics.and(this._ta, this._taIdx, value);
	this._notify();
	return v;
    },

    or: function (value) {
	const v = Atomics.or(this._ta, this._taIdx, value);
	this._notify();
	return v;
    },

    xor: function (value) {
	const v = Atomics.xor(this._ta, this._taIdx, value);
	this._notify();
	return v;
    },

    exchange: function (value) {
	// TODO
	throw new Error("exchange not implemented");
    },

    loadWhenEqual: function (value) {
	var v;
	while ((v = Atomics.load(this._ta, this._taIdx)) != value)
	    this._expectUpdate(v);
	return v;
    },

    loadWhenNotEqual: function (value) {
	var v;
	while ((v = Atomics.load(this._ta, this._taIdx)) == value)
	    this._expectUpdate(v);
	return v;
    },

    // FutexWait can only wait on an int32 value.
    //
    // For integer variants just wait on the data word itself.  If the
    // byte size of the element type is less than 4 then the data are
    // in the low bytes of the data word when it is loaded as an
    // int32.  When loaded as an int32 the upper bits will always be
    // zero, so the currentValue, if signed, must be stripped of its
    // high bits before we use it.

    _expectUpdate: function (currentValue) {
	currentValue &= this._unsignedMask;
	while (Atomics.load(this._ia, this._iaIdx) == currentValue)
	    Atomics.futexWait(this._ia, this._iaIdx, currentValue, Number.POSITIVE_INFINITY);
    },

    _notify: function () {
	Atomics.futexWake(this._ia, this._iaIdx, Number.POSITIVE_INFINITY);
    }
};

const _Synchronic_endian = (function () {
    var v = new Int32Array(1);
    var b = new Int8Array(v.buffer);
    v[0] = 0x12345678;
    if (b[0] == 0x12)
	return "big";
    return "little";
})();

const _Synchronic_constructorFor = function (constructor) {
    var floating;
    var numBytes = 4;

    switch (constructor) {
    case SharedInt8Array:    tag = "int8"; break;
    case SharedUint8Array:   tag = "uint8"; break;
    case SharedInt16Array:   tag = "int16"; break;
    case SharedUint16Array:  tag = "uint16"; break;
    case SharedInt32Array:   tag = "int32"; break;
    case SharedUint32Array:  tag = "uint32"; break;
    case SharedFloat32Array: tag = "float32"; floating = true; numBytes = 8; break;
    case SharedFloat64Array: tag = "float64"; floating = true; numBytes = 16; break;
    default:
	throw new Error("Invalid constructor for Synchronic: " + constructor);
    }

    const taName = "_synchronic_" + tag + "_view";
    const bpe = constructor.BYTES_PER_ELEMENT;
    const mask = bpe >= 4 ? -1 : (1 << bpe*8)-1;

    const makeType =
	function (sab, index, initialize) {
	    index = index|0;
	    initialize = !!initialize;
	    if (!(sab instanceof SharedArrayBuffer))
		throw new Error("Synchronic not onto SharedArrayBuffer");
	    if (index < 0 || (index & (numBytes-1)))
		throw new Error("Synchronic at negative or unaligned index");
	    if (index + numBytes > sab.byteLength)
		throw new Error("Synchronic extends beyond end of buffer");
	    if (!sab._synchronic_int32_view)
		sab._synchronic_int32_view = new SharedInt32Array(sab);
	    if (!sab[taName])
		sab[taName] = new constructor(sab);
	    this._ta = sab[taName];
	    // TODO: something better for floating types!
	    if (_Synchronic_endian == "big")
		this._taIdx = index / bpe;
	    else
		this._taIdx = index / bpe + (4 - bpe);
	    this._ia = sab._synchronic_int32_view;
	    this._iaIdx = index / 4;
	    this._unsignedMask = mask;
	    if (initialize)
		Atomics.store(this._ta, this._taIdx, 0);
	};

    makeType.NUMBYTES = numBytes;
    if (floating)
	makeType.prototype = _Synchronic_floating_methods;
    else
	makeType.prototype = _Synchronic_int_methods;
    return makeType;
}

var SynchronicInt8 = _Synchronic_constructorFor(SharedInt8Array);
var SynchronicUint8 = _Synchronic_constructorFor(SharedUint8Array);
var SynchronicInt16 = _Synchronic_constructorFor(SharedInt16Array);
var SynchronicUint16 = _Synchronic_constructorFor(SharedUint16Array);
var SynchronicInt32 = _Synchronic_constructorFor(SharedInt32Array);
var SynchronicUint32 = _Synchronic_constructorFor(SharedUint32Array);
var SynchronicFloat32 = _Synchronic_constructorFor(SharedFloat32Array);
var SynchronicFloat64 = _Synchronic_constructorFor(SharedFloat64Array);

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
 * - loadWhenEqual(x [,t]) waits until the value in the object is x
 *   or t milliseconds have passed; it returns x
 * - loadWhenNotEqual(x [,t]) waits until the value in the object is
 *   not x or t milliseconds have passed; it returns the value in the
 *   object
 *
 * The methods that store values in the object will wake threads that
 * are waiting in loadWhenEqual / loadWhenNotEqual as appropriate.
 *
 * Synchronization:
 *
 * - loadWhenEqual() and loadWhenNotEqual() synchronize-with the methods
 *   that store values (store, compareExchange, add, sub, and, or, xor,
 *   and exchange)
 *
 * For floating-point values equality is defined as:
 *  - if values are not NaN then equality is defined by ==
 *  - if values are NaN then values are equal if they are both NaN
 *
 * TODO:
 *  - we /might/ need the updating methods to take a hint about how
 *    many waiters to wake.  The C++ proposal has none/one/all.  But
 *    hints are not great for JS - we'd like something binding, or
 *    nothing at all.
 *  - we /might/ want to provide expectUpdate(), but the C++ spec
 *    of that is quite vague, it looks like a hook to take advantage
 *    of a wakeup broadcast without checking the resulting value,
 *    ie, "if client code will check anyway then we don't need
 *    the check that comes with loadWhenNotEqual".   How useful is
 *    that for JS?
 *  - we /probably/ want to implement isLockFree().
 */

const _Synchronic_now = (function () {
    if (this.performance && typeof performance.now == 'function')
	return performance.now.bind(performance);
    return Date.now.bind(Date);
})();

/* Implementation:
 *
 * For integer types we use a single int32 cell for the value.  For
 * byte and halfword the value is arranged in the low half of the
 * int32.  The size of a Synchronic for byte and halfword is four bytes.
 *
 * Note Atomics.futexWait() can only wait on an int32 value.
 *
 * For integer variants we just wait on the data word itself.  If the
 * byte size of the element type is less than 4 then the data are
 * in the low bytes of the data word when it is loaded as an
 * int32.  When loaded as an int32 the upper bits will always be
 * zero, so the currentValue, if signed, must be stripped of its
 * high bits before we use it.
 *
 * (It seems probable that for good performance we need a count of
 * waiters to avoid calling futexWake on every update, so the size
 * probably has to increase.)
 */
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
	var v = Atomics.compareExchange(this._ta, this._taIdx, oldval, newval);
	if (v == oldval)
	    this._notify();
	return v;
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
	throw new Error("exchange not implemented, waiting for native support");
    },

    loadWhenEqual: function (value, timeout) {
	var v;
	if (timeout !== undefined) {
	    var now = _Synchronic_now();
	    var limit = now + timeout;
	    while ((v = Atomics.load(this._ta, this._taIdx)) != value && now < limit) {
		this._expectUpdate(v, limit - now);
		now = _Synchronic_now();
	    }
	}
	else {
	    while ((v = Atomics.load(this._ta, this._taIdx)) != value)
		this._expectUpdate(v, Number.POSITIVE_INFINITY);
	}
	return v;
    },

    loadWhenNotEqual: function (value, timeout) {
	var v;
	if (timeout !== undefined) {
	    var now = _Synchronic_now();
	    var limit = now + timeout;
	    while ((v = Atomics.load(this._ta, this._taIdx)) == value && now < limit) {
		this._expectUpdate(v, limit - now);
		now = _Synchronic_now();
	    }
	}
	else {
	    while ((v = Atomics.load(this._ta, this._taIdx)) == value)
		this._expectUpdate(v, Number.POSITIVE_INFINITY);
	}
	return v;
    },

    _expectUpdate: function (currentValue, timeout) {
	Atomics.futexWait(this._ia, this._iaIdx, currentValue & this._unsignedMask, timeout);
    },

    _notify: function () {
	Atomics.futexWake(this._ia, this._iaIdx, Number.POSITIVE_INFINITY);
    },
};

const _Synchronic_constructorForInt = function (constructor) {
    const BIG = 1;
    const LITTLE = 2;

    var tag = "";
    var endian = 0;

    if (!endian) {
	var words = new Int32Array(1);
	var bytes = new Int8Array(words.buffer);
	words[0] = 0x12345678;
	endian = (bytes[0] == 0x12) ? BIG : LITTLE;
    }

    switch (constructor) {
    case SharedInt8Array:    tag = "int8"; break;
    case SharedUint8Array:   tag = "uint8"; break;
    case SharedInt16Array:   tag = "int16"; break;
    case SharedUint16Array:  tag = "uint16"; break;
    case SharedInt32Array:   tag = "int32"; break;
    case SharedUint32Array:  tag = "uint32"; break;
    default:                 throw new Error("Invalid constructor for Synchronic: " + constructor);
    }

    const taName = "_synchronic_" + tag + "_view";

    const makeSynchronicIntType =
	function (sab, index, initialize) {
	    index = index|0;
	    initialize = !!initialize;
	    if (!(sab instanceof SharedArrayBuffer))
		throw new Error("Synchronic not onto SharedArrayBuffer");
	    if (index < 0 || (index & 3))
		throw new Error("Synchronic at negative or unaligned index");
	    if (index + 4 > sab.byteLength)
		throw new Error("Synchronic extends beyond end of buffer");
	    if (!sab._synchronic_int32_view)
		sab._synchronic_int32_view = new SharedInt32Array(sab);
	    if (!sab[taName])
		sab[taName] = new constructor(sab);
	    this._ta = sab[taName];
	    const bpe = constructor.BYTES_PER_ELEMENT;
	    if (endian == BIG)
		this._taIdx = index / bpe;
	    else
		this._taIdx = index / bpe + (4 - bpe);
	    this._ia = sab._synchronic_int32_view;
	    this._iaIdx = index / 4;
	    this._unsignedMask = bpe == 4 ? -1 : (1 << bpe*8)-1;
	    if (initialize)
		Atomics.store(this._ta, this._taIdx, 0);
	};

    makeSynchronicIntType.prototype = _Synchronic_int_methods;
    makeSynchronicIntType.NUMBYTES = 4;

    return makeSynchronicIntType;
}

/* For the float methods we use a seqLock to coordinate access to the
 * datum because the datum comprises both the value in the cell and
 * the integer that we'll wait on, a sequence number:
 * Atomics.futexWait can't wait on a floating point value.
 *
 * As for the int case we probably want a counter to track the number
 * of waiters, to avoid calling futexWake on every update.
 *
 * The float methods can be adapted to values of larger size (though
 * for those values "add" and "sub" won't make sense).
 *
 * NOTE!  Untested as of 2015-03-12 because Spidermonkey does not yet
 * support atomics on float32 and float64.
 */

const _Synchronic_float_methods =
{
    load: function () {
	var [v,_] = this._read();
	return v;
    },

    store: function (value) {
	var seq0 = this._acquireWrite();
	Atomics.store(this._ta, this._taIdx, value);
	this._releaseWrite(seq0);
    },

    compareExchange: function (oldval, newval) {
	// TODO
	throw new Error("compareExchange not implemented");
    },

    add: function (value) {
	var seq0 = this._acquireWrite();
	const ta = this._ta;
	const taIdx = this._taIdx;
	var v = Atomics.load(ta, taIdx);
	Atomics.store(ta, taIdx, v+value);
	this._releaseWrite(seq0);
	return v;
    },

    sub: function (value) {
	var seq0 = this._acquireWrite();
	const ta = this._ta;
	const taIdx = this._taIdx;
	var v = Atomics.load(ta, taIdx);
	Atomics.store(ta, taIdx, v-value);
	this._releaseWrite(seq0);
	return v;
    },

    exchange: function (value) {
	// TODO
	throw new Error("exchange not implemented");
    },

    loadWhenEqual: function (value, timeout) {
	if (timeout !== undefined) {
	    var now = _Synchronic_now();
	    var limit = now + timeout;
	    for (;;) {
		var [v, seq0] = this._read();
		if (v == value || isNaN(value) && isNaN(v) || now >= limit)
		    break;
		this._expectUpdate(v, seq0, limit - now);
		now = _Synchronic_now();
	    }
	}
	else {
	    for (;;) {
		var [v, seq0] = this._read();
		if (v == value || isNaN(value) && isNaN(v))
		    break;
		this._expectUpdate(v, seq0, Number.POSITIVE_INFINITY);
	    }
	}
	return v;
    },

    loadWhenNotEqual: function (value, timeout) {
	if (timeout !== undefined) {
	    var now = _Synchronic_now();
	    var limit = now + timeout;
	    for (;;) {
		var [v, seq0] = this._read();
		if (!(v == value || isNaN(value) && isNaN(v)) || now >= limit)
		    break;
		this._expectUpdate(v, seq0, limit - now);
		now = _Synchronic_now();
	    }
	}
	else {
	    for (;;) {
		var [v, seq0] = this._read();
		if (!(v == value || isNaN(value) && isNaN(v)))
		    break;
		this._expectUpdate(v, seq0, Number.POSITIVE_INFINITY);
	    }
	}
	return v;
    },

    _read: function () {
	const ia = this._ia;
	const seqIdx = this._seqIdx;
	const ta = this._ta;
	const taIdx = this._taIdx;
	var seq0, seq1, v;
	do {
	    seq0 = Atomics.load(ia, seqIdx);
	    v = Atomics.load(ta, taIdx);
	    seq1 = Atomics.load(ia, seqIdx);
	} while (seq0 != seq1 || (seq0 & 1));
	return [v, seq0];
    },

    _expectUpdate: function (currentValue, currentSeq, timeout) {
	const ia = this._ia;
	const seqIdx = this._seqIdx;
	// If the cell value has been updated since it was read, then either
	// the sequence number will have been updated too, and we will not
	// wait, or we will be awoken explicitly after that update.
	Atomics.futexWait(ia, seqIdx, currentSeq, timeout);
    },

    _acquireWrite: function () {
	const ia = this._ia;
	const seqIdx = this._seqIdx;
	var seq0, nseq;
	seq0 = Atomics.load(ia, seqIdx);
	while ((seq0 & 1) || (nseq = Atomics.compareExchange(ia, seqIdx, seq0, seq0+1)) != seq0)
	    seq0 = nseq;
	return seq0;
    },

    _releaseWrite: function (currentSeq) {
	const ia = this._ia;
	const seqIdx = this._seqIdx;
	Atomics.store(ia, seqIdx, currentSeq+2);
	Atomics.futexWake(ia, seqIdx, Number.POSITIVE_INFINITY);
    }
};

const _Synchronic_constructorForFloat = function (constructor) {
    var numBytes = 0;
    var offset = 0;
    var tag = "";

    switch (constructor) {
    case SharedFloat32Array: tag = "float32"; floating = true; numBytes = 8; offset=4; break;  // Extra word for seq
    case SharedFloat64Array: tag = "float64"; floating = true; numBytes = 16; offset=8; break; // Extra word for seq+padding
    default:                 throw new Error("Invalid constructor for Synchronic: " + constructor);
    }

    const taName = "_synchronic_" + tag + "_view";

    const makeSynchronicFloatType =
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
	    const bpe = constructor.BYTES_PER_ELEMENT;
	    this._ta = sab[taName];
	    this._taIdx = index / bpe;
	    this._ia = sab._synchronic_int32_view;
	    this._seqIdx = (index / 4) + offset;
	    if (initialize)
		Atomics.store(this._ta, this._taIdx, 0);
	};

    makeSynchronicFloatType.prototype = _Synchronic_float_methods;
    makeSynchronicFloatType.NUMBYTES = numBytes;

    return makeSynchronicFloatType;
}

var SynchronicInt8 = _Synchronic_constructorForInt(SharedInt8Array);
var SynchronicUint8 = _Synchronic_constructorForInt(SharedUint8Array);
var SynchronicInt16 = _Synchronic_constructorForInt(SharedInt16Array);
var SynchronicUint16 = _Synchronic_constructorForInt(SharedUint16Array);
var SynchronicInt32 = _Synchronic_constructorForInt(SharedInt32Array);
var SynchronicUint32 = _Synchronic_constructorForInt(SharedUint32Array);
var SynchronicFloat32 = _Synchronic_constructorForFloat(SharedFloat32Array);
var SynchronicFloat64 = _Synchronic_constructorForFloat(SharedFloat64Array);

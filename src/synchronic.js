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
 * sab that is divisible by (in this case) SynchronicInt32.BYTES_PER_ELEMENT
 * and "initialize" MUST be true for the first caller that creates
 * the Synchronic object on that particular area of memory.  That
 * first call MUST return before any constructor calls on that memory
 * in other threads may start.
 *
 * (Similarly for Int8, Uint8, Int16, Uint16, Uint32, Float32, and
 * Float64.)
 *
 * Each constructor function has a property BYTES_PER_ELEMENT, which
 * denotes the number of bytes in the SharedArrayBuffer that MUST be
 * reserved for a Synchronic of the given type.  This value includes
 * any padding and control words; the memory required for an array of
 * Synchronic objects is thus the length of the array times the
 * BYTES_PER_ELEMENT value for the base type.
 *
 * All Synchronic objects have the following value manipulation
 * methods (all are atomic and mirror their counterparts on the
 * Atomics object):
 *
 * - load() retrieves the current value of the object
 * - store(v) stores v in the object
 * - compareExchange(o, n) stores n in the object if its current
 *   value c is equal to o, and in any case returns c
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
 * Finally, objects have methods that wait for and signal events:
 *
 * - loadWhenEqual(x) waits until the value in the object is observed
 *   to be x.  It then returns the value in the cell (which may no
 *   longer be x).
 *
 * - loadWhenNotEqual(x) waits until the value in the object is
 *   observed to be other than x.  It then returns the value in the
 *   cell (which may once again be x).
 *
 * - expectUpdate(x, t) waits until the value in the cell is no longer
 *   x or t milliseconds have passed.  It returns nothing.
 *
 * - notify() asks all waiters to re-check their waiting conditions.
 *
 *
 * The methods that store values in the object will send notifications
 * as appropriate.
 *
 * Synchronization [NEEDS WORK]
 *
 * - loadWhenEqual(), loadWhenNotEqual(), load(), and expectUpdate()
 *   synchronize-with notify(), which is (notionally) invoked by the
 *   methods that store values: store, compareExchange, add, sub, and,
 *   or, xor, and exchange
 *
 * - actually it's more complicated of course since add, sub etc are
 *   both load and store.
 *
 *
 * TODO:
 *
 *  - we /might/ need the updating methods to take a hint about how
 *    many waiters to wake.  The C++ proposal has none/one/all.  But
 *    hints are not great for JS - we'd like something binding, or
 *    nothing at all.
 *
 *  - we /probably/ want to implement isLockFree().
 */

const _Synchronic_now = (function () {
    if (this.performance && typeof performance.now == 'function')
	return performance.now.bind(performance);
    return Date.now.bind(Date);
})();

/* A Synchronic for integer types occupies 8 bytes.  The first four
 * bytes hold the value, the last four bytes hold a counter for the
 * number of waiting threads.
 *
 * For byte and halfword types the value is arranged in the low half
 * of the four-byte datum.
 *
 * Atomics.futexWait can only wait on an int32; it waits on the entire
 * first data word.  If the byte size of the element type is less than
 * 4 then the data are in the low bytes of the data word when it is
 * loaded as an int32.  When loaded as an int32 the upper bits will
 * always be zero, so the currentValue that guards the wait must be
 * stripped of its high bits before we use it.
 */
const _Synchronic_int_methods =
{
    isLockFree: function () {
	return Atomics.isLockFree(this._ta.BYTES_PER_ELEMENT);
    },

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
	const v = Atomics.exchange(this._ta, this._taIdx, value);
	this._notify();
	return v;
    },

    loadWhenNotEqual: function (value_) {
	var value = this._coerce(value_);
	this._waitForUpdate(value, Number.POSITIVE_INFINITY);
	return Atomics.load(this._ta, this._taIdx);
    },

    loadWhenEqual: function (value_) {
	var value = this._coerce(value_);
	for ( var v=Atomics.load(this._ta, this._taIdx) ; v !== value ; v=Atomics.load(this._ta, this._taIdx))
	    this._waitForUpdate(v, Number.POSITIVE_INFINITY);
	return v;
    },

    expectUpdate: function (value_, timeout_) {
	var value = this._coerce(value_);
	var timeout = +timeout_;
	var now = _Synchronic_now();
	var limit = now + timeout;
	for ( var v=Atomics.load(this._ta, this._taIdx) ; v !== value && now < limit ; v=Atomics.load(this._ta, this._taIdx)) {
	    this._waitForUpdate(v, limit - now);
	    now = _Synchronic_now();
	}
    },

    notify: function() {
	this._notify();
    },

    _waitForUpdate: function (currentValue, timeout) {
	Atomics.add(this._ia, this._iaIdx+1, 1);
	Atomics.futexWait(this._ia, this._iaIdx, currentValue & this._unsignedMask, timeout);
	Atomics.sub(this._ia, this._iaIdx+1, 1);
    },

    _notify: function () {
	if (Atomics.load(this._ia, this._iaIdx+1) > 0)
	    Atomics.futexWake(this._ia, this._iaIdx, Number.POSITIVE_INFINITY);
    }
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

    const _coerce_int = function (v) { return v|0; }
    const _coerce_uint = function (v) { return v>>>0; }

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

    // TODO: some of the properties on "this" are shared among all synchronics of
    // the same underlying type, and could be lifted to a shared prototype object:
    //
    // - _unsignedMask
    // - _coerce

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
	    this._coerce = tag == "uint32" ? _coerce_uint : _coerce_int;
	    if (initialize) {
		Atomics.store(this._ta, this._taIdx, 0);
		Atomics.store(this._ia, this._iaIdx+1, 0);
	    }
	};

    makeSynchronicIntType.prototype = _Synchronic_int_methods;
    makeSynchronicIntType.BYTES_PER_ELEMENT = 8;

    return makeSynchronicIntType;
}

// FLOAT CODE IS NOT TESTED YET

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
 */

/* Here we need to use three words for float and four words for double,
   since we need both the sequence number and a count of waiters.
   */

const _Synchronic_float_methods =
{
    load: function () {
	var [v,_] = this._read();
	return v;
    },

    store: function (value_) {
	var value = +value_;
	var seq0 = this._acquireWrite();
	Atomics.store(this._ta, this._taIdx, value);
	this._releaseWrite(seq0);
    },

    // If the value in the cell and oldval are both zero but with
    // different signs then this method will still replace the value
    // in the cell (and will return the old value in the cell).
    //
    // If the value in the cell and oldval are both canonical NaN then
    // this will replace the value in the cell.
    //
    // If the value in the cell is a non-canonical NaN then this will
    // not replace the value even if oldval is a NaN.  Such a value
    // can only be set by smuggling it in through aliasing, and should
    // not be an issue in practice.

    compareExchange: function (oldval_, newval_) {
	var oldval = +oldval_;
	var newval = +newval_;
	var seq0 = this._acquireWrite();
	var v = Atomics.compareExchange(this._ta, this._taIdx, oldval, newval);
	if (oldval === 0.0 && v === 0.0 && 1/(oldval*v) < 0)
	    v = Atomics.compareExchange(this._ta, this._taIdx, v, newval);
	/*
	else if (isNaN(oldval) && isNaN(v)) {
	    // Consider the case where the value in the cell is
	    // noncanonical NaN, in that case we need to do a CAS with
	    // the noncanonical NaN for oldval.  That is not
	    // expressible in JS, Waldo had the same issue with some
	    // of the self-hosted TypedArray copy primitives.
	}
	*/
	this._releaseWrite(seq0);
	return v;
    },

    add: function (value_) {
	var value = +value_;
	var seq0 = this._acquireWrite();
	const ta = this._ta;
	const taIdx = this._taIdx;
	var v = Atomics.load(ta, taIdx);
	Atomics.store(ta, taIdx, v+value);
	this._releaseWrite(seq0);
	return v;
    },

    sub: function (value_) {
	var value = +value_;
	var seq0 = this._acquireWrite();
	const ta = this._ta;
	const taIdx = this._taIdx;
	var v = Atomics.load(ta, taIdx);
	Atomics.store(ta, taIdx, value);
	this._releaseWrite(seq0);
	return v;
    },

    exchange: function (value_) {
	var value = +value_;
	var seq0 = this._acquireWrite();
	var v = Atomics.exchange(this._ta, this._taIdx, value);
	this._releaseWrite(seq0);
	return v;
    },

    // a equals b iff a === b || isNaN(a) && isNaN(b)
    loadWhenNotEqual: function (value_) {
	const value = +value_;
	for (;;) {
	    var [v, seq0] = this._read();
	    if (!(v === value || isNaN(value) && isNaN(v)))
		break;
	    this._waitForUpdate(seq0, Number.POSITIVE_INFINITY);
	}
	return v;
    },

    // a equals b iff a === b || isNaN(a) && isNaN(b)
    loadWhenEqual: function (value_) {
	const value = +value_;
	for (;;) {
	    var [v, seq0] = this._read();
	    if (v === value || isNaN(value) && isNaN(v))
		break;
	    this._waitForUpdate(seq0, Number.POSITIVE_INFINITY);
	}
	return v;
    },

    // a equals b iff a === b || isNaN(a) && isNaN(b)
    expectUpdate: function (value_, timeout_) {
	var value = +value_;
	var timeout = +timeout_;
	var now = _Synchronic_now();
	var limit = now + timeout;
	for (;;) {
	    var [v, seq0] = this._read();
	    if (!(v === value || isNaN(value) && isNaN(v)) || now >= limit)
		break;
	    this._waitForUpdate(seq0, limit - now);
	    now = _Synchronic_now();
	}
    },

    notify: function () {
	this._notify();
    },

    _read: function () {
	const ia = this._ia;
	const iaIdx = this._iaIdx;
	const ta = this._ta;
	const taIdx = this._taIdx;
	var seq0, seq1, v;
	do {
	    seq0 = Atomics.load(ia, iaIdx);
	    v = Atomics.load(ta, taIdx);
	    seq1 = Atomics.load(ia, iaIdx);
	} while (seq0 != seq1 || (seq0 & 1));
	return [v, seq0];
    },

    _acquireWrite: function () {
	const ia = this._ia;
	const iaIdx = this._iaIdx;
	var seq0, nseq;
	seq0 = Atomics.load(ia, iaIdx);
	while ((seq0 & 1) || (nseq = Atomics.compareExchange(ia, iaIdx, seq0, seq0+1)) != seq0)
	    seq0 = nseq;
	return seq0;
    },

    _releaseWrite: function (currentSeq) {
	Atomics.store(this._ia, this._iaIdx, currentSeq+2);
	this._notify();
    },

    // If the cell value has been updated since it was read, then either
    // the sequence number will have been updated too, and we will not
    // wait, or we will be awoken explicitly after that update.

    _waitForUpdate: function (currentSeq, timeout) {
	const ia = this._ia;
	const iaIdx = this._iaIdx;

	Atomics.add(ia, iaIdx+1, 1);
	Atomics.futexWait(ia, iaIdx, currentSeq, timeout);
	Atomics.sub(ia, iaIdx+1, 1);
    },

    _notify: function () {
	const ia = this._ia;
	const iaIdx = this._iaIdx;

	if (Atomics.load(ia, iaIdx+1))
	    Atomics.futexWake(ia, iaIdx, Number.POSITIVE_INFINITY);
    }
};

const _Synchronic_constructorForFloat = function (constructor) {
    var offset = 0;
    var tag = "";

    switch (constructor) {
    case SharedFloat32Array: tag = "float32"; floating = true; offset=4; break;  // Extra words for seq+count+padding
    case SharedFloat64Array: tag = "float64"; floating = true; offset=8; break;  // Extra words for seq+count
    default:                 throw new Error("Invalid constructor for Synchronic: " + constructor);
    }

    const taName = "_synchronic_" + tag + "_view";

    const makeSynchronicFloatType =
	function (sab, index, initialize) {
	    index = index|0;
	    initialize = !!initialize;
	    if (!(sab instanceof SharedArrayBuffer))
		throw new Error("Synchronic not onto SharedArrayBuffer");
	    if (index < 0 || (index & 15))
		throw new Error("Synchronic at negative or unaligned index");
	    if (index + 16 > sab.byteLength)
		throw new Error("Synchronic extends beyond end of buffer");
	    if (!sab._synchronic_int32_view)
		sab._synchronic_int32_view = new SharedInt32Array(sab);
	    if (!sab[taName])
		sab[taName] = new constructor(sab);
	    const bpe = constructor.BYTES_PER_ELEMENT;
	    this._ta = sab[taName];
	    this._taIdx = index / bpe;
	    this._ia = sab._synchronic_int32_view;
	    this._iaIdx = (index / 4) + offset;
	    if (initialize)
		Atomics.store(this._ta, this._taIdx, 0);
	};

    makeSynchronicFloatType.prototype = _Synchronic_float_methods;
    makeSynchronicFloatType.BYTES_PER_ELEMENT = 16;

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

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

"use strict";

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
 * and "initialize" MUST be true for exactly one agent that creates
 * the Synchronic object on that particular area of memory.  That
 * initializing call MUST return before any methods may be called on
 * the synchronic in any agent.
 *
 * Similarly for Int8, Uint8, Int16, Uint16, and Uint32.
 *
 * NOTE  Float variants are not yet supported, but will be.
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
 * NOTE   The exchange method is currently disabled, because the Atomics
 *        support for exchange has not yet landed.
 *
 * Finally, objects have methods that wait for and signal events:
 *
 * - loadWhenEqual(x) waits until the value in the object is observed
 *   to be x, this could be immediately.  It then returns the value in
 *   the cell (which may no longer be x).
 *
 * - loadWhenNotEqual(x) waits until the value in the object is
 *   observed to be other than x, this could be immediately.  It then
 *   returns the value in the cell (which may once again be x).
 *
 * - expectUpdate(x, t) waits until the value in the cell may no
 *   longer be x - this could be immediately - or t milliseconds have
 *   passed.  It returns nothing.
 *
 * - notify() asks all waiters to re-check their waiting conditions.
 *
 * The methods that store values in the object will send notifications
 * as appropriate, there is rarely a need to call notify().
 *
 * Synchronization:
 *
 * - The methods that load are: loadWhenEqual(), loadWhenNotEqual(),
 *   load(), expectUpdate(), add(), sub(), and(), or(), xor(),
 *   compareExchange(), and exchange().
 *
 * - The methods that store are: store(), add(), sub(), and(), or(),
 *   xor(), compareExchange(), notify(), and exchange().
 *
 * - A call that stores into a synchronic S synchronizes-with
 *   temporally succeeding calls that load from S.
 *
 *
 * TODO:
 *
 *  - we /might/ need the updating methods to take a hint about how
 *    many waiters to wake.  The C++ proposal has none/one/all.  But
 *    hints are not great for JS - we'd like something binding, or
 *    nothing at all.
 *
 *  - the requirement that the allocation address be divisible by
 *    the size of the synchronic is stricter than necessary.
 */

/*
 * A synchronic<integer> is 16 bytes / 4 ints, as follows:
 *  - the value, four bytes but not all may be used, accessed atomically
 *  - the number of waiters
 *  - the wait word, a generation number used for futexWait / futexWake
 *  - unused
 */
const _Synchronic_int_methods =
{
    isLockFree: function () {
	// ints are always lock-free, and this API is probably
	// superflous now.
	return true;
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

    /* API not yet available in Firefox */
    /*
    exchange: function (value) {
	const v = Atomics.exchange(this._ta, this._taIdx, value);
	this._notify();
	return v;
    },
    */

    loadWhenNotEqual: function (value_) {
	var value = this._coerce(value_);
	for (;;) {
	    var tag = Atomics.load(this._ia, this._iaIdx+2);
	    var v = Atomics.load(this._ta, this._taIdx) ;
	    if (v !== value)
		break;
	    this._waitForUpdate(tag, Number.POSITIVE_INFINITY);
	}
	return v;
    },

    loadWhenEqual: function (value_) {
	var value = this._coerce(value_);
	for (;;) {
	    var tag = Atomics.load(this._ia, this._iaIdx+2);
	    var v = Atomics.load(this._ta, this._taIdx) ;
	    if (v === value)
		break;
	    this._waitForUpdate(tag, Number.POSITIVE_INFINITY);
	}
	return v;
    },

    expectUpdate: function (value_, timeout_) {
	var value = this._coerce(value_);
	var timeout = +timeout_;
	var now = this._now();
	var limit = now + timeout;
	for (;;) {
	    var tag = Atomics.load(this._ia, this._iaIdx+2);
	    var v = Atomics.load(this._ta, this._taIdx) ;
	    if (v !== value || now >= limit)
		break;
	    this._waitForUpdate(tag, limit - now);
	    now = this._now();
	}
    },

    notify: function() {
	this._notify();
    },

    _waitForUpdate: function (tag, timeout) {
	Atomics.add(this._ia, this._iaIdx+1, 1);
	Atomics.futexWait(this._ia, this._iaIdx+2, tag, timeout);
	Atomics.sub(this._ia, this._iaIdx+1, 1);
    },

    _notify: function () {
	Atomics.add(this._ia, this._iaIdx+2, 1);
	if (Atomics.load(this._ia, this._iaIdx+1) > 0)
	    Atomics.futexWake(this._ia, this._iaIdx+2, Number.POSITIVE_INFINITY);
    },

    _now: (typeof 'performance' != 'undefined' && typeof performance.now == 'function'
	   ? performance.now.bind(performance)
	   : Date.now.bind(Date))
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
    // - _coerce

    const syncSize = 16;

    const makeSynchronicIntType =
	function (sab, offset, initialize) {
	    offset = offset|0;
	    initialize = !!initialize;
	    if (!(sab instanceof SharedArrayBuffer))
		throw new Error("Synchronic not onto SharedArrayBuffer");
	    if (offset < 0 || (offset & (syncSize-1)))
		throw new Error("Synchronic at negative or unaligned index");
	    if (offset + syncSize > sab.byteLength)
		throw new Error("Synchronic extends beyond end of buffer");
	    if (!sab._synchronic_int32_view)
		sab._synchronic_int32_view = new SharedInt32Array(sab);
	    if (!sab[taName])
		sab[taName] = new constructor(sab);
	    this._ta = sab[taName];
	    this._taIdx = offset / constructor.BYTES_PER_ELEMENT;
	    this._ia = sab._synchronic_int32_view;
	    this._iaIdx = offset / 4;
	    this._coerce = tag == "uint32" ? _coerce_uint : _coerce_int;
	    if (initialize) {
		Atomics.store(this._ta, this._taIdx, 0);
		Atomics.store(this._ia, this._iaIdx+1, 0);
		Atomics.store(this._ia, this._iaIdx+2, 0);
	    }
	};

    makeSynchronicIntType.prototype = _Synchronic_int_methods;
    makeSynchronicIntType.BYTES_PER_ELEMENT = syncSize;

    return makeSynchronicIntType;
}

var SynchronicInt8 = _Synchronic_constructorForInt(SharedInt8Array);
var SynchronicUint8 = _Synchronic_constructorForInt(SharedUint8Array);
var SynchronicInt16 = _Synchronic_constructorForInt(SharedInt16Array);
var SynchronicUint16 = _Synchronic_constructorForInt(SharedUint16Array);
var SynchronicInt32 = _Synchronic_constructorForInt(SharedInt32Array);
var SynchronicUint32 = _Synchronic_constructorForInt(SharedUint32Array);

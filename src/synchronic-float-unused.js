/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// FLOAT CODE IS NOT TESTED YET
// See synchronic.js for more information.
// This code will / should be folded into synchronic.js once it's tested.

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

/* For Float64:
   - one part
   - the other part
   - waiter count
   - wait word: high 31 bits are generation number, low bit is spinlock

   For Float32 - can't use int methods for add and sub, but can use CAS loop for that.
   - the value
   - unused
   - waiter count
   - wait word: high 31 bits are generation number, low bit is spinlock
*/

// TODO: split this apart.

const _Synchronic_float_methods =
{
    load: function () {
	this._acquire();
	var v = this._ta[this._taIdx];
	this._release();
	return v;
    },

    store: function (value_) {
	var value = +value_;
	this._acquire();
	this._ta[this._taIdx] = value;
	this._release();
	this._notify();
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
	this._acquire();
	var oldval = this._ta[this._taIdx];
	this._ta[this._taIdx] = oldval + value;
	this._release();
	this._notify();
	return oldval;
    },

    sub: function (value_) {
	var value = +value_;
	this._acquire();
	var oldval = this._ta[this._taIdx];
	this._ta[this._taIdx] = oldval - value;
	this._release();
	this._notify();
	return oldval;
    },

    exchange: function (value_) {
	var value = +value_;
	this._acquire();
	var oldval = this._ta[this._taIdx];
	this._ta[this._taIdx] = value;
	this._release();
	this._notify();
	return oldval;
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

    // Simple spinlock.

    _acquire: function () {
	while (Atomics.compareExchange(this._ia, this._iaIdx+2, 0, 1) == 1)
	    ;
    },

    _release: function () {
	Atomics.store(this._ia, this._iaIdx+2, 0);
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
	Atomics.add(this._ia, this._iaIdx+2, 1);
	if (Atomics.load(this._ia, this._iaIdx+1) > 0)
	    Atomics.futexWake(this._ia, this._iaIdx+2, Number.POSITIVE_INFINITY);
    },

    _notify: function () {
	const ia = this._ia;
	const iaIdx = this._iaIdx;

	if (Atomics.load(ia, iaIdx+1))
	    Atomics.futexWake(ia, iaIdx, Number.POSITIVE_INFINITY);
    },

    _now: (typeof 'performance' != 'undefined' && typeof performance.now == 'function'
	   ? performance.now.bind(performance)
	   : Date.now.bind(Date))
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

var SynchronicFloat32 = _Synchronic_constructorForFloat(SharedFloat32Array);
var SynchronicFloat64 = _Synchronic_constructorForFloat(SharedFloat64Array);

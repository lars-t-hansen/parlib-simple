// This is probably slightly redundant until we implement SharedHeap, the
// key was to get the atomics for Float64 and they are in
// float64atomics.js.

function AtomicInt8(i8ab, i8base) {
    if (!(i8ab instanceof SharedInt8Array))
	throw new Error("AtomicInt8 can only be constructed on a SharedInt8Array");
    this.i8ab = i8ab;
    this.i8base = i8base;
}

AtomicInt8.NUMINTS = 0;	// Number of integer elements for bookkeeping.  This will remain zero.

AtomicInt8.prototype.get = function () { return Atomics.load(this.i8ab, this.i8base); };
AtomicInt8.prototype.set = function (x) { Atomics.store(this.i8ab, this.i8base, x); };
AtomicInt8.prototype.add = function (v) { return Atomics.add(this.i8ab, this.i8base, v); };
AtomicInt8.prototype.sub = function (v) { return Atomics.sub(this.i8ab, this.i8base, v); }
AtomicInt8.prototype.compareExchange = function (expected, replacement) {
    return Atomics.compareExchange(this.i8ab, this.i8base, expected, replacement);
}

// For float32 the sane implementation maps a SharedInt32Array onto the float array,
// it can even attach the latter to the former for reuse.  (Non-enumerable is good.)
// That just highlights the insanity of not supporting the atomics for Float32Array.

// AtomicFloat64
//
// Here we require an additional array for bookkeeping data, hence
// four arguments.  Note the data word and the bookkeeping word(s)
// need not be adjacent in memory.

function AtomicFloat64(f64ab, f64base, iab, ibase) {
    if (!(f64ab instanceof SharedFloat64Array))
	throw new Error("AtomicFloat64 can only be constructed on a SharedFloat64Array");
    if (!(iab instanceof SharedInt32Array))
	throw new Error("AtomicFloat64 requires a SharedInt32Array for bookkeeping");
    this.f64ab = f64ab;
    this.f64base = f64base;
    this.iab = iab;
    this.ibase = ibase;
}

AtomicFloat64.NUMINTS = Atomics.NUMF64INTS;	// Number of elements in the additional array

AtomicFloat64.prototype.get = function () {
    return Atomics.float64Load(this.f64ab, this.f64base, this.iab, this.ibase);
};

AtomicFloat64.prototype.set = function (x) {
    Atomics.float64Store(this.f64ab, this.f64base, this.iab, this.ibase, x);
}

AtomicFloat64.prototype.compareEchange = function (expected, update) {
    return Atomics.float64CompareExchange(this.f64ab, this.f64base, this.iab, this.ibase, expected, update);
}

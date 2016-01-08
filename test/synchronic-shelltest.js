load("../src/synchronic.js");

// Basic tests

var sab = new SharedArrayBuffer(4096);

// Assume: SynchronicT.BYTE_ALIGNMENT <= 16 for all T.

var s = new SynchronicInt32(sab, 16, true);
assertEq(s.load(), 0);
s.store(37);
assertEq(s.load(), 37);
s.store(-42);
assertEq(s.load(), -42);
assertEq(s.add(5), -42);
assertEq(s.and(15), -37); // 0xff..db
assertEq(s.load(), 11);

setSharedArrayBuffer(sab);

evalInWorker(`
load("../src/synchronic.js");
var sab = getSharedArrayBuffer();
var s = new SynchronicInt32(sab, 16);
assertEq(s.load(), 11);
assertEq(s.loadWhenEqual(11), 11);
var then = Date.now();
assertEq(s.loadWhenEqual(12), 12);
print("Waited (A) " + (Date.now() - then) + " (should be approx 1000ms)");
sleep(1);
s.store(13);
`);

sleep(1);
s.store(12);

var then = Date.now();
assertEq(s.loadWhenEqual(13), 13);
print("Waited (B) " + (Date.now() - then) + " (should be approx 1000ms)");

var s = new SynchronicInt8(sab, 32, true);

evalInWorker(`
load("../src/synchronic.js");
var sab = getSharedArrayBuffer();
var s = new SynchronicInt8(sab, 32);
var then = Date.now();
s.expectUpdate(0, 500);  // Should timeout before value is set
assertEq(s.load(), 0);   // Ergo value should be unchanged
print("Waited (C) " + (Date.now() - then) + " (should be approx 500ms)");
var then = Date.now();
assertEq(s.loadWhenEqual(-8), -8);
print("Waited (D) " + (Date.now() - then) + " (should be approx 500ms)");
`);

sleep(1);
s.store(-8);
sleep(1);

// Ditto float

print("Float32");

var s = new SynchronicFloat32(sab, 48, true);
assertEq(s.load(), 0);
s.store(37.5);
assertEq(s.load(), 37.5);
s.store(-42.5);
assertEq(s.load(), -42.5);
assertEq(s.add(5), -42.5);
assertEq(s.load(), -37.5);

setSharedArrayBuffer(sab);

evalInWorker(`
load("../src/synchronic.js");
var sab = getSharedArrayBuffer();
var s = new SynchronicFloat32(sab, 48);
assertEq(s.load(), -37.5);
assertEq(s.loadWhenEqual(-37.5), -37.5);
var then = Date.now();
assertEq(s.loadWhenEqual(12.5), 12.5);
print("Waited (A) " + (Date.now() - then) + " (should be approx 1000ms)");
sleep(1);
s.store(13.5);
`);

sleep(1);
s.store(12.5);

var then = Date.now();
assertEq(s.loadWhenEqual(13.5), 13.5);
print("Waited (B) " + (Date.now() - then) + " (should be approx 1000ms)");

print("Float64");

memset(sab, 48, 0, SynchronicFloat64.BYTES_PER_ELEMENT);

var s = new SynchronicFloat64(sab, 48, true);
assertEq(s.load(), 0);
s.store(37.5);
assertEq(s.load(), 37.5);
s.store(-42.5);
assertEq(s.load(), -42.5);
assertEq(s.add(5), -42.5);
assertEq(s.load(), -37.5);

setSharedArrayBuffer(sab);

evalInWorker(`
load("../src/synchronic.js");
var sab = getSharedArrayBuffer();
var s = new SynchronicFloat64(sab, 48);
assertEq(s.load(), -37.5);
assertEq(s.loadWhenEqual(-37.5), -37.5);
var then = Date.now();
assertEq(s.loadWhenEqual(12.5), 12.5);
print("Waited (A) " + (Date.now() - then) + " (should be approx 1000ms)");
sleep(1);
s.store(13.5);
`);

sleep(1);
s.store(12.5);

var then = Date.now();
assertEq(s.loadWhenEqual(13.5), 13.5);
print("Waited (B) " + (Date.now() - then) + " (should be approx 1000ms)");

function memset(sab, offset, val, len) {
    if (len == 0)
	return;
    var mem = new Int8Array(sab, offset, len);
    for ( var i=0 ; i < len-1 ; i++ )
	mem[i] = val;
    // Publish those values
    Atomics.store(mem, len-1, val);
}

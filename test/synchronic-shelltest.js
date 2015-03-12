load("../src/synchronic.js");

// Basic test

var sab = new SharedArrayBuffer(4096);

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

// Int8Array tests both sub-word logic and signed logic

var s = new SynchronicInt8(sab, 32, true);

evalInWorker(`
load("../src/synchronic.js");
var sab = getSharedArrayBuffer();
var s = new SynchronicInt8(sab, 32);
var then = Date.now();
assertEq(s.loadWhenEqual(-8, 500), 0); // Timeout should get us before the value changes
print("Waited (C) " + (Date.now() - then) + " (should be approx 500ms)");
var then = Date.now();
assertEq(s.loadWhenEqual(-8), -8);
print("Waited (D) " + (Date.now() - then) + " (should be approx 500ms)");
`);

sleep(1);
s.store(-8);

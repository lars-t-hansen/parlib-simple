load("../src/alloc.js");

var sab = new SharedArrayBuffer(1024*1024);

SharedAlloc.initialize(sab, 0, sab.byteLength);

var sa = new SharedAlloc(sab, 0);

var xa = sa.Int32Array;
var v, w, u;
print("@" + (v = sa.allocInt32(4))*4);
print("  " + xa[v-2]);
print("  " + xa[v-1]);
print("@" + (w = sa.allocInt32(5))*4);
print("  " + xa[w-2]);
print("  " + xa[w-1]);
print("@" + (u = sa.allocInt32(4))*4);
print("  " + xa[u-2]);
print("  " + xa[u-1]);
sa.freeInt32(w);
sa.freeInt32(u);
sa.freeInt32(v);
var n = sa.allocInt32(5);
print(n*4);
var m = sa.allocInt32(4);
print(m*4);
var k = sa.allocInt32(4);
print(k*4);
sa._printFree();
var k = sa.allocInt32(4);
print(k*4);
var m = sa.allocInt32(254);	// Should be small (header+obj == 1024 bytes)
assertEq(m == 0, false);
sa.freeInt32(m);
var n = sa.allocInt32(255);	// Should be large (header+obj > 1024 bytes)
assertEq(n == 0, false);
sa.freeInt32(n);


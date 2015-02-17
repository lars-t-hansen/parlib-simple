load("../src/int64atomics.js");

function int64Set(ia, x, hi, lo) {
    // Little endian, so lsw first
    ia[4] = lo;
    ia[5] = hi;
}

function int64RefLo(ia, x) {
    return ia[x];
}

function int64RefHi(ia, x) {
    return ia[x+1];
}

function int64Ref(ia, x) {
    return {hi: int64RefHi(ia, x), lo: int64RefLo(ia, x) };
}

var xx = new SharedInt32Array(Atomics.NUMI64INTS);
var ia = new SharedInt32Array(10);

// Little endian, so lsw first
int64Set(ia, 4, -1, -2);

assertEq(Atomics.int64Load(ia, 4, xx, 0), -2);
assertEq(Atomics.int64HighBits(), -1);

assertEq(Atomics.int64CompareExchange(ia, 4, -1, -2, 0, 7, xx, 0), -2);
assertEq(Atomics.int64HighBits(), -1);

assertEq(int64RefHi(ia, 4), 0);
assertEq(int64RefLo(ia, 4), 7);

Atomics.int64Store(ia, 4, -1, -10, xx, 0);

assertEq(int64RefHi(ia, 4), -1);
assertEq(int64RefLo(ia, 4), -10);

Atomics.int64Add(ia, 4, 0, 20, xx, 0);

assertEq(int64RefHi(ia, 4), 0);
assertEq(int64RefLo(ia, 4), 10);

Atomics.int64Sub(ia, 4, 0, 15, xx, 0);

assertEq(int64RefHi(ia, 4), -1);
assertEq(int64RefLo(ia, 4), -5);

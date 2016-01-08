load("../src/int64atomics.js");

// Little endian, so lsw first
function int64Set(ia, x, hi, lo) {
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

var xx = new Int32Array(new SharedArrayBuffer(Atomics.NUMI64INTS*Int32Array.BYTES_PER_ELEMENT));
var ia = new Int32Array(new SharedArrayBuffer(10*Int32Array.BYTES_PER_ELEMENT));

Atomics.int64Init(xx, 0);

int64Set(ia, 4, -1, -2);

assertEq(Atomics.int64Load(ia, 4), -2);
assertEq(Atomics.H, -1);

assertEq(Atomics.int64CompareExchange(ia, 4, -1, -2, 0, 7), -2);
assertEq(Atomics.H, -1);

assertEq(int64RefHi(ia, 4), 0);
assertEq(int64RefLo(ia, 4), 7);

Atomics.int64Store(ia, 4, -1, -10);

assertEq(int64RefHi(ia, 4), -1);
assertEq(int64RefLo(ia, 4), -10);

Atomics.int64Add(ia, 4, 0, 20);

assertEq(int64RefHi(ia, 4), 0);
assertEq(int64RefLo(ia, 4), 10);

Atomics.int64Sub(ia, 4, 0, 15);

assertEq(int64RefHi(ia, 4), -1);
assertEq(int64RefLo(ia, 4), -5);

Atomics.int64Store(ia, 4, 0x55555555, 0x55555555);
Atomics.int64Or(ia, 4, 0xAAAAAAAA|0, 0xAAAAAAAA|0);

assertEq(int64RefHi(ia, 4), -1);
assertEq(int64RefLo(ia, 4), -1);

Atomics.int64Store(ia, 4, 0x55555555, 0x55555555);
Atomics.int64And(ia, 4, 0x33333333, 0xDDDDDDDD|0);

assertEq(int64RefHi(ia, 4), 0x11111111);
assertEq(int64RefLo(ia, 4), 0x55555555);

Atomics.int64Xor(ia, 4, 0x33333333, 0x77777777);

assertEq(int64RefHi(ia, 4), 0x22222222);
assertEq(int64RefLo(ia, 4), 0x22222222);

print("Done");

// SpiderMonkey shell test for polyfilled futexes

load("futex.js");

var nelem = 256;
var fsab = new SharedArrayBuffer(Futex.BYTE_SIZE + nelem * 4);

Futex.initMemory(fsab, 0);

Futex.setup(fsab, 0);
Futex.tagBuffer(fsab, 0);

setSharedArrayBuffer(fsab);

var mymem = new Int32Array(fsab, Futex.BYTE_SIZE, nelem);

evalInWorker(`
load("futex.js");
var fsab = getSharedArrayBuffer();

Futex.setup(fsab, 0);
Futex.tagBuffer(fsab, 0);

var mymem = new Int32Array(fsab, Futex.BYTE_SIZE, ${nelem});

var then = Date.now();
Futex.wait(mymem, 0, 0);
var now = Date.now();
console.log("Waited (should be approx 1000): " + (now - then));

var then = Date.now();
Futex.wait(mymem, 0, 0, 500);
var now = Date.now();
console.log("Waited (should be approx 500): " + (now - then));
`);

sleep(1);
Futex.wake(mymem, 0, 1);

sleep(1);
Futex.wake(mymem, 0, 1);

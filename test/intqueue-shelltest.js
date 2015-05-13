load("../src/arena.js");
load("../src/synchronic.js");
load("../src/intqueue.js");

// Basic test

var sab = new SharedArrayBuffer(4096); // Keep it short for better testing

var q = new IntQueue(sab, 0, sab.byteLength);

setSharedArrayBuffer(sab);

var iterations = 10000;

evalInWorker(
`
load("../src/arena.js");
load("../src/synchronic.js");
load("../src/intqueue.js");

var iterations=${iterations};
var sab = getSharedArrayBuffer();
var q = new IntQueue(sab, 0, sab.byteLength);

var xs = [];
for ( var i=0 ; i < iterations ; i++ ) {
    var v = q.dequeue();
    // if (!(i % 999))
    // 	print(v.toSource());
    for ( var j=0 ; j < v.length ; j++ )
	assertEq(v[j], i+j);
}
`);

for ( var i=0 ; i < iterations ; i++ ) {
    q.enqueue([i,i+1,i+2,i+3,i+4]);
}

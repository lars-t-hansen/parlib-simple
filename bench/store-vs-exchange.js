var ia = new Int32Array(new SharedArrayBuffer(1024));

function f1() {
   for ( let i=0 ; i < 10000 ; i++ )
     Atomics.exchange(ia, 0, 0);
}
function g1() {
   for ( let i=0 ; i < 1000 ; i++ )
     f1();
}

function f2() {
   for ( let i=0 ; i < 10000 ; i++ )
     Atomics.store(ia, 0, 0);
}
function g2() {
   for ( let i=0 ; i < 1000 ; i++ )
     f2();
}

print("Executing 10e6 Atomics.store and Atomics.exchange operations");

var then = Date.now();
g1();
var now = Date.now();

print("Exchange: " + (now - then) + "ms");

var then = Date.now();
g2();
var now = Date.now();

print("Store: " + (now - then) + "ms");

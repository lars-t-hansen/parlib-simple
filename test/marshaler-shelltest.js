/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Sanity tests for the marshaling code to be run in the shell.

load("../src/marshaler.js");

var m1 = new Marshaler();
var m2 = new Marshaler();
var global = this;

// Illustrate the extensible marshaling by passing a function (as source code).

var FuncID = m1.generateID("function", null);

m2.registerID("function",
	      FuncID,
	      function (m, vs) {
		  // Could eval as function definition, but function expression is
		  // cleaner for the purposes of testing.
		  return global.eval("(" + m.unmarshal(vs, 1, vs.length-1)[0] + ")");
	      });

Function.prototype.toMarshaled =
    function (m) {
	var { values, newSAB } = m.marshal([this.toSource()]);
	values.unshift(FuncID);
	return values;
    };

var s1 = new SharedArrayBuffer(100);
var s2 = new SharedArrayBuffer(200);
var i1 = new Int32Array(s1, 20, 5);
var f1 = new Float64Array(s2, 8, 20);
var ab = new ArrayBuffer(20);
var tmp = new Uint8Array(ab);
for ( var i=0 ; i < tmp.length ; i++ )
    tmp[i] = i;
var i32a = new Int32Array(ab, 4, 3);  // bytes 3..15
var u8a = new Uint8Array(ab, 10, 10); // bytes 10..19
var a0 = ["hi", 37, ["ho", "hum"],,14];
var o0 = { foo: "1", bar: a0 };
var t1 = [undefined, null, true, false,
	  37, Math.PI, "foobar", "basic",
	  s1, s1, s2, i1,
	  f1, ab, i32a, u8a,
	  a0, o0, fib ];

function fib(n) {
    if (n < 2)
	return n;
    return fib(n-1) + fib(n-2);
}

var v = m1.marshal(t1);

assertEq(v.newSAB.length, 2);
assertEq(v.newSAB[0].sab === s1 || v.newSAB[1].sab === s1, true);
assertEq(v.newSAB[0].sab === v.newSAB[1].sab, false);
assertEq(v.newSAB[0].id === v.newSAB[1].id, false);

assertEq(m1.getSAB(v.newSAB[0].id), v.newSAB[0].sab);
assertEq(m1.getSAB(v.newSAB[1].id), v.newSAB[1].sab);

assertEq(m1.getSAB(2), null);	// Whitebox knowledge: the ID range is dense

assertEq(m2.registerSAB(v.newSAB[0].sab, v.newSAB[0].id), v.newSAB[0].id);
assertEq(m2.registerSAB(v.newSAB[1].sab, v.newSAB[1].id), v.newSAB[1].id);

var t2 = m2.unmarshal(v.values, 0, v.values.length);

assertEq(t1.length, t2.length);
for ( var i=0 ; i < 8 ; i++ )
    assertEq(t1[i], t2[i]);

assertEq(t2[8] instanceof SharedArrayBuffer, true);
assertEq(t2[9] instanceof SharedArrayBuffer, true);
assertEq(t2[10] instanceof SharedArrayBuffer, true);
assertEq(t2[11] instanceof Int32Array, true);
assertEq(t2[12] instanceof Float64Array, true);
assertEq(t2[8], t2[9]);
assertEq(t2[8].byteLength, t2[8].byteLength);

assertEq(t2[11].buffer, t2[8]);
assertEq(t2[12].buffer, t2[10]);

assertEq(t2[13] instanceof ArrayBuffer, true);
assertEq(t2[13].byteLength, ab.byteLength);
var tmp2 = new Uint8Array(ab);
for ( var i=0 ; i < tmp.length ; i++ )
    assertEq(tmp2[i], i);

assertEq(t2[14] instanceof Int32Array, true);
assertEq(t2[14].length, i32a.length);
for ( var i=0 ; i < i32a.length ; i++ )
    assertEq(t2[14][i], i32a[i]);

assertEq(t2[15] instanceof Uint8Array, true);
assertEq(t2[15].length, u8a.length);
for ( var i=0 ; i < u8a.length ; i++ )
    assertEq(t2[15][i], u8a[i]);

assertEq(Array.isArray(t2[16]), true);
assertEq(t2[16].length, a0.length);
assertEq(Array.isArray(t2[16][2]), true);
assertEq(t2[16][2].length, a0[2].length);
assertEq(3 in t2[16], false);

for ( var k in o0 ) {
    assertEq(t2[17].hasOwnProperty(k), true);
}

assertEq(typeof t2[18], 'function');
assertEq(t2[18](10), 55);  // fib(10) => 55

print("Done");

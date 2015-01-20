/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Sanity tests for the marshaling code to be run in the shell.

load("../src/marshal.js");

var m1 = new Marshaler();
var m2 = new Marshaler();

var s1 = new SharedArrayBuffer(100);
var s2 = new SharedArrayBuffer(200);
var i1 = new SharedInt32Array(s1, 20, 5);
var f1 = new SharedFloat64Array(s2, 8, 20);
var t1 = [undefined, null, true, false, 37, Math.PI, "foobar", "basic", s1, s1, s2, i1, f1];
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
assertEq(t2[11] instanceof SharedInt32Array, true);
assertEq(t2[12] instanceof SharedFloat64Array, true);
assertEq(t2[8], t2[9]);
assertEq(t2[8].byteLength, t2[8].byteLength);

assertEq(t2[11].buffer, t2[8]);
assertEq(t2[12].buffer, t2[10]);

print("Done");

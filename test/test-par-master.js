/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var numWorkers = 4;
var padding = 32;
var height = 45;
var width = 37;
var arraySize = height*width;
var mem = new Int32Array(new SharedArrayBuffer((2*padding + MasterPar.NUMINTS + arraySize)*Int32Array.BYTES_PER_ELEMENT));
var array = new Int32Array(new SharedArrayBuffer((mem.buffer, (padding+MasterPar.NUMINTS)*4, arraySize)*Int32Array.BYTES_PER_ELEMENT));
var aux = new Int32Array(new SharedArrayBuffer(numWorkers*Int32Array.BYTES_PER_ELEMENT)); // This needs to have a distinct SharedArrayBuffer
var Par;
var bias = 37;

for ( var i=0 ; i < numWorkers ; i++ )
    aux[i] = bias;

// Set up the padding
for ( var i=0 ; i < padding ; i++ ) {
    mem[i] = 0x0F0E0D0C;
    mem[mem.length-1-i] = 0x0C0D0E0F;
}

function runTest() {
    Par = new MasterPar(mem, padding, numWorkers, "test-par-worker.js", ready);
}

var expected = 0;
var steps = 0;
var maxSteps = 10;
var xs = [];

function ready() {
    // Test Par.self on the worker side; also tests eval()
    Par.setMessageNotUnderstood(function (x) { xs.push(x) });
    Par.eval(ready2, "postMessage(Par.self);");
}

function ready2() {
    var selfs = "";
    for ( var i=0 ; i < numWorkers ; i++ )
	selfs += i;
    if (xs.sort().join("") != selfs)
	throw new Error("Problem with Par.self: " + xs.join(" "));
    Par.setMessageNotUnderstood(null);

    // Test broadcast
    Par.broadcast(null, "setParameters", height, width, aux);

    // Test eval + queueing
    Par.eval(null, "function fudge(x) { return x }");

    // Test invoke, and on the first go-around test queueing as well
    doStep();
}

function doStep() {
    msg("Step " + (steps+1));
    var r1 = Math.floor(Math.random() * 100) * (steps % 2 ? -1 : 1);
    var r2 = Math.floor(Math.random() * 100) * (steps % 2 ? -1 : 1);
    Par.invoke(stepDone, "computeStep", [[0,height], [0,width]], array, r1, r2);
    expected += r1+r2+bias;
}

function stepDone() {
    var failures = 0;

    ++steps;

    // Check the result
    for ( var h=0 ; h < height ; h++ )
	for ( var w=0 ; w < width ; w++ ) {
	    var item = array[h*width+w];
	    if (item != expected)
		if (++failures < 10)
		    msg("Step " + steps + ": Failed @ " + h + ", " + w + ": " + item);
	}

    // Check the padding
    for ( var i=0 ; i < padding ; i++ ) {
	if (mem[i] != 0x0F0E0D0C)
	    if (++failures < 10)
		msg("Step " + steps + ": Padding failed @ " + i + ": " + mem[i].toString(16));
	if (mem[mem.length-1-i] != 0x0C0D0E0F)
	    if (++failures < 10)
		msg("Step " + steps + ": Padding failed @ " + mem.length-1-i + ": " + mem[mem.length-1-i].toString(16));
    }

    if (failures == 0 && steps < maxSteps)
	doStep();
    else
	msg("Done");
}

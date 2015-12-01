/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Animation parameters

const magFactor = 1.05;
const maxIterations = 250;

// The memory contains two height*width grids (so that we can overlap
// display and computation) and extra shared space for the Par
// framework.

const rawmem = new SharedArrayBuffer(4*(height*width*2 + MasterPar.NUMINTS));
const mem1 = new Int32Array(rawmem, 0, height*width);
const mem2 = new Int32Array(rawmem, height*width*4, height*width);
const memp = new Int32Array(rawmem, height*width*4*2, MasterPar.NUMINTS);

// Note, numWorkers is set by the .html document.

const Par = new MasterPar(memp, 0, numWorkers, "mandelbrot-worker.js", doMandelbrot);

var magnification = 1;
var iterations = 0;
var mem = mem1;
var timeBefore;

function doMandelbrot() {
    Par.invoke(showMandelbrot, "mandelbrot", [[0,height], [0,width]], mem, magnification);
}

function showMandelbrot() {
    var memnow = mem;
    if (iterations == 0)
	timeBefore = Date.now();
    if (iterations < maxIterations) {
	iterations++;
	magnification *= magFactor;
	mem = (memnow == mem1) ? mem2 : mem1;
	// Overlap display of this frame with computation of the next.
	doMandelbrot();
    }
    else {
	var t = Date.now() - timeBefore;
	var fps = Math.round((iterations/(t/1000))*10)/10;
	document.getElementById('mystatus').innerHTML = "Number of workers: " + numWorkers + "  Compute time: " + t + "ms  FPS=" + fps;
    }
    canvasSetFromABGRBytes(document.getElementById("mycanvas"),
			   new Uint8Array(rawmem, memnow.byteOffset, height*width*4),
			   height,
			   width);
}

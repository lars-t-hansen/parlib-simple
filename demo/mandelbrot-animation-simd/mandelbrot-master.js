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

const rawmem = new SharedArrayBuffer(roundupAsmJSHeapLength(4*(height*width*2 + MasterPar.NUMINTS + 8)));
const mem1 = new SharedInt32Array(rawmem, 0, height*width);
const mem2 = new SharedInt32Array(rawmem, height*width*4, height*width);
const memp = new SharedInt32Array(rawmem, height*width*4*2, MasterPar.NUMINTS);
const colbase = 4*(height*width*2 + MasterPar.NUMINTS);
const colmem = new SharedInt32Array(rawmem, colbase, 8);

// Note, numWorkers is set by the .html document.

const Par = new MasterPar(memp, 0, numWorkers, "mandelbrot-worker.js", setupMandelbrot);

var magnification = 1;
var iterations = 0;
var mem = mem1;
var timeBefore;

function setupMandelbrot() {
    Par.broadcast(doMandelbrot, "setup_asm", colmem);
}

function doMandelbrot() {
    Par.invoke(showMandelbrot, "mandelbrot_" + mode, [[0,height], [0,width]], mem, magnification);
}

function setMode(new_mode) {
    mode = new_mode;
    // if (iterations > 0)
    // 	timeBefore = Date.now();
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
	document.getElementById('mystatus').innerHTML =
	    "Mode: " + mode +
	    "Number of workers: " + numWorkers + "  Compute time: " + t + "ms  FPS=" + fps;
    }

    // Fixme: we want a notion of running FPS, and once we get to the bottom we want to zoom out again,
    // and just keep going, so that one can change between settings.  Also pause/continue will be very
    // useful, and it should be possible to click radio buttons while paused.

    canvasSetFromABGRBytes(document.getElementById("mycanvas"),
			   new SharedUint8Array(rawmem, memnow.byteOffset, height*width*4),
			   height,
			   width);
}

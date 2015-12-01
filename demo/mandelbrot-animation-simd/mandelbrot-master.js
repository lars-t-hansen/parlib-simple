/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Animation parameters

const magFactor = 1.025;	// with 1.5 pixelation is a problem after a while, because of float32
const maxIterations = 400;

// The memory contains two height*width grids (so that we can overlap
// display and computation) and extra shared space for the Par
// framework.

const rawmem = new SharedArrayBuffer(roundupAsmJSHeapLength(4*(height*width*2 + MasterPar.NUMINTS + 8)));
const mem1 = new Int32Array(rawmem, 0, height*width);
const mem2 = new Int32Array(rawmem, height*width*4, height*width);
const memp = new Int32Array(rawmem, height*width*4*2, MasterPar.NUMINTS);
const colbase = 4*(height*width*2 + MasterPar.NUMINTS);
const colmem = new Int32Array(rawmem, colbase, 8);

// Note, numWorkers is set by the .html document.

const Par = new MasterPar(memp, 0, numWorkers, "mandelbrot-worker.js", setupMandelbrot);

var magnification = 1;
var going_in = true;
var iterations = 0;
var fps_iterations = 0;
var mem = mem1;
var timeBefore;
var lastDisplay = 0;

function setupMandelbrot() {
    Par.broadcast(doMandelbrot, "setup_asm", colmem);
}

function doMandelbrot() {
    Par.invoke(showMandelbrot, "mandelbrot_" + mode, [[0,height], [0,width]], mem, magnification);
}

function setMode(new_mode) {
    mode = new_mode;
    fps_iterations = 0;
    if (iterations > 0)
     	timeBefore = Date.now();
}

function showMandelbrot() {
    var doDisplay = true;
    var memnow = mem;
    var now = Date.now();

    if (iterations == 0) {
	timeBefore = now;
	lastDisplay = now;
	doDisplay = false;
    }

    iterations++;
    fps_iterations++;
    if (iterations == maxIterations) {
	going_in = !going_in;
	iterations = 1;
    }

    if (going_in)
	magnification *= magFactor;
    else
	magnification /= magFactor;

    mem = (memnow == mem1) ? mem2 : mem1;

    // Overlap display of this frame with computation of the next.
    doMandelbrot();

    if (now - lastDisplay >= 1000) {
	lastDisplay = now;
	var t = now - timeBefore;
	var fps = Math.round((fps_iterations/(t/1000))*10)/10;
	document.getElementById('mystatus').innerHTML =
	    "Mode: " + mode + " " +
	    "Number of workers: " + numWorkers + "  Compute time: " + t + "ms  FPS=" + fps;
    }

    if (doDisplay) {
	canvasSetFromABGRBytes(document.getElementById("mycanvas"),
			       new Uint8Array(rawmem, memnow.byteOffset, height*width*4),
			       height,
			       width);
    }
}

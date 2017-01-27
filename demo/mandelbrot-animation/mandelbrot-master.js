/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// We set up shared memory and a Barrier and distribute them to the
// workers.  The workers then enter the barrier.  Once they've all
// done so the master receives a callback, after which it distributes
// animation parameters and releases the workers.  After they have
// computed they enter the barrier again; the master gets another
// callback; and so on.  The master signals that the work is finished
// by passing distinguished terminal values for the animation
// parameters.

// Animation parameters

const magFactor = 1.05;
const maxIterations = 250;	// Set to 1 for a single frame

// The memory contains the height*width grid and extra shared space
// for the barrier that is used to coordinate workers.

const rawmem = new SharedArrayBuffer((height*width + MasterBarrier.NUMINTS)*4 + 1*8);
const intmem = new Int32Array(rawmem, 0, height*width + MasterBarrier.NUMINTS);
const flomem = new Float64Array(rawmem, (height*width + MasterBarrier.NUMINTS)*4, 1);
const barrierLoc = (height*width); // Within intmem
const magnificationLoc = 0;        // Within flomem
const barrierID = 1337;

// Note, numWorkers is set by the .html document.

const barrier = new MasterBarrier(intmem, barrierLoc, barrierID, numWorkers, barrierCallback);
const sliceHeight = Math.ceil(height/numWorkers);

for ( var i=0 ; i < numWorkers ; i++ ) {
    var w = new Worker("mandelbrot-worker.js");
    MasterBarrier.addWorker(w);
    w.postMessage(["setup",
		   rawmem,
		   intmem.byteOffset,
		   intmem.length,
		   flomem.byteOffset,
		   flomem.length,
		   barrierID,
		   barrierLoc,
		   magnificationLoc,
		   i*sliceHeight,
		   (i == numWorkers-1 ? height : (i+1)*sliceHeight)]);
}

var magnification = 1;
var iterations = 0;
var timeBefore = 0;

function barrierCallback() {
    if (!timeBefore)
	timeBefore = Date.now();
    else {
	canvasSetFromABGRBytes(document.getElementById("mycanvas"),
			       new Uint8Array(rawmem, 0, height*width*4),
			       height,
			       width);
	magnification *= magFactor;
    }

    if (iterations++ < maxIterations)
	flomem[magnificationLoc] = magnification;
    else {
	flomem[magnificationLoc] = (iterations++ < maxIterations) ? magnification : 0;
	var time = (Date.now() - timeBefore)
	document.getElementById("mystatus").textContent =
	    "Number of workers: " + numWorkers + "  Compute time: " + time + "ms  Frames: " + maxIterations + "  FPS: " + (maxIterations/(time/1000));
    }

    barrier.release();
}

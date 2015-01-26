/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// 2015-01-20 / lhansen@mozilla.com
//
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

const mem = new SharedInt32Array(height*width + 1 + MasterBarrier.NUMINTS);
const sab = mem.buffer;
const magnificationLoc = height*width;
const barrierLoc = magnificationLoc+1; // Barrier memory follows grid memory
const barrierID = 1337;

// Note, numWorkers is set by the .html document.

const barrier = new MasterBarrier(mem, barrierLoc, barrierID, numWorkers, barrierCallback);
const sliceHeight = Math.ceil(height/numWorkers);

for ( var i=0 ; i < numWorkers ; i++ ) {
    var w = new Worker("mandelbrot-worker.js");
    w.onmessage =
	function (ev) {
	    if (Array.isArray(ev.data) && ev.data[0] === "MasterBarrier.dispatch")
		MasterBarrier.dispatch(ev.data);
	    else
		console.log(ev.data);
	}
    w.postMessage([sab,
		   barrierID,
		   barrierLoc,
		   magnificationLoc,
		   i*sliceHeight,
		   (i == numWorkers-1 ? height : (i+1)*sliceHeight)],
		  [sab]);
}

var magnification = 1;
var iterations = 0;
var timeBefore = 0;

function barrierCallback() {
    if (!timeBefore)
	timeBefore = Date.now();
    else {
	canvasSetFromABGRBytes(document.getElementById("mycanvas"),
			       new SharedUint8Array(sab, 0, height*width*4),
			       height,
			       width);
	magnification *= magFactor;
    }

    if (iterations++ < maxIterations)
	mem[magnificationLoc] = magnification;
    else {
	mem[magnificationLoc] = (iterations++ < maxIterations) ? magnification : 0;
	var time = (Date.now() - timeBefore)
	document.getElementById("mystatus").textContent =
	    "Number of workers: " + numWorkers + "  Compute time: " + time + "ms  Frames: " + maxIterations + "  FPS: " + (maxIterations/(time/1000));
    }

    barrier.release();
}

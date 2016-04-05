/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// See explanation in mandelbrot-master.js.

importScripts("../../util/shim.js",
	      "../../src/message.js",
	      "../../src/asymmetric-barrier.js",
	      "mandelbrot-parameters.js");

dispatchMessage(self, "setup", function (data) {
    var [_, sab, intByteOffset, intLength, floByteOffset, floLength, barrierID, barrierLoc, magnificationLoc, ybase, ylimit] = data;
    var intmem = new Int32Array(sab, intByteOffset, intLength);
    var flomem = new Float64Array(sab, floByteOffset, floLength);
    var barrier = new WorkerBarrier(intmem, barrierLoc, barrierID);

    barrier.enter();
    while (flomem[magnificationLoc] != 0) {
	mandelbrot(intmem, ybase, ylimit, flomem[magnificationLoc]);
	barrier.enter();
    }
});

// Maximum iterations per pixel.
const MAXIT = 200;

// Colors are ABGR with A=255.
const colors = [0xFFFF0700, 0xFF2a2aa5, 0xFFFFff00, 0xFFa19eff,
		0xFF00eefd, 0xFF008000, 0xFFFAFEFE, 0xFF00FFBF];

// Compute a strip of pixels from ybase <= y < ylimit.
function mandelbrot(mem, ybase, ylimit, magnification) {
    const g_top = g_center_y + 1/magnification;
    const g_bottom = g_center_y - 1/magnification;
    const g_left = g_center_x - width/height*1/magnification;
    const g_right = g_center_x + width/height*1/magnification;
    for ( var Py=ybase ; Py < ylimit ; Py++ ) {
	for ( var Px=0 ; Px < width ; Px++ ) {
	    var x0 = g_left+(Px/width)*(g_right-g_left);
	    var y0 = g_bottom+(Py/height)*(g_top-g_bottom);
	    var x = 0.0;
	    var y = 0.0;
	    var it = 0;
	    while (x*x + y*y < 4.0 && it < MAXIT) {
		var xtemp = x*x - y*y + x0;
		y = 2.0*x*y + y0;
		x = xtemp;
		it++;
	    }
	    mem[Py*width+Px] = it == MAXIT ? 0xFF000000 : colors[it & 7];
	}
    }
}

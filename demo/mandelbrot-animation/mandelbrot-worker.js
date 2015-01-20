/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// 2015-01-20 / lhansen@mozilla.com
//
// See explanation in mandelbrot-master.js.

importScripts("../../src/asymmetric-barrier.js",
	      "mandelbrot-parameters.js");

onmessage =
    function (ev) {
	var [sab, barrierID, barrierLoc, magnificationLoc, ybase, ylimit] = ev.data;
	var mem = new SharedInt32Array(sab);
	var barrier = new WorkerBarrier(mem, barrierLoc, barrierID);

	barrier.enter();
	while (mem[magnificationLoc] != 0) {
	    mandelbrot(mem, ybase, ylimit, mem[magnificationLoc]);
	    barrier.enter();
	}
    };

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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

importScripts("../../util/shim.js",
	      "../../src/message.js",
	      "../../src/asymmetric-barrier.js",
	      "../../src/marshaler.js",
	      "../../src/par.js",
	      "mandelbrot-parameters.js");

const Par = new WorkerPar();

// Colors are ABGR with A=255.
const colors = [0xFFFF0700, 0xFF2a2aa5, 0xFFFFff00, 0xFFa19eff,
		0xFF00eefd, 0xFF008000, 0xFFFAFEFE, 0xFF00FFBF];

// Compute a square of pixels into mem with y in [ybase, ylimit)
// and x in [xbase, xlimit).

function mandelbrot_js(ybase, ylimit, xbase, xlimit, mem, magnification) {
    const g_top = g_center_y + 1/magnification;
    const g_bottom = g_center_y - 1/magnification;
    const g_left = g_center_x - width/height*1/magnification;
    const g_right = g_center_x + width/height*1/magnification;
    for ( var Py=ybase ; Py < ylimit ; Py++ ) {
	for ( var Px=xbase ; Px < xlimit ; Px++ ) {
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

// colbase_ is the slot offset within the memory for the color table: 8 integers.

var colbase;

function setup_asm(mem) {
    for ( var i=0 ; i < 8 ; i++ )
	mem[i] = colors[i];
    colbase = mem.byteOffset;
}

// This is valid asm.js and it uses float.  It is about the same speed
// as the JS version (as was a double variant i had earlier), probably
// because IonMonkey does a really good job on this kind of code.

function mandelbrot_asm_module(glob, ffi, heap) {
    "use asm";

    var i32 = new glob.Int32Array(heap);
    var aload = glob.Atomics.load; // Declare shared memory
    var imul = glob.Math.imul;
    var toF = glob.Math.fround;
    const MAXIT = ffi.MAXIT|0;

    function mbrot(ybase, ylimit, xbase, xlimit, width, height, g_center_y, g_center_x, membase, colbase, magnification) {
	ybase = ybase|0;
	ylimit = ylimit|0;
	xbase = xbase|0;
	xlimit = xlimit|0;
	width = width|0;
	height = height|0;
	g_center_y = toF(g_center_y);
	g_center_x = toF(g_center_x);
	membase = membase|0;
	colbase = colbase|0;
	magnification = toF(magnification);
	var g_top = toF(0);
	var g_bottom = toF(0);
	var g_left = toF(0);
	var g_right = toF(0);
	var Py = 0;
	var Px = 0;
	var x0 = toF(0);
	var y0 = toF(0);
	var x = toF(0);
	var y = toF(0);
	var it = 0;
	var xtemp = toF(0);
	var loc = 0;
	g_top = toF(g_center_y + toF(toF(1)/magnification));
	g_bottom = toF(g_center_y - toF(toF(1)/magnification));
	g_left = toF(g_center_x - toF(toF(toF(width|0) / toF(height|0)) * toF(toF(1)/magnification)));
	g_right = toF(g_center_x + toF(toF(toF(width|0) / toF(height|0)) * toF(toF(1)/magnification)));
	for ( Py=ybase ; (Py|0) < (ylimit|0) ; Py=(Py+1)|0 ) {
	    for ( Px=xbase ; (Px|0) < (xlimit|0) ; Px=(Px+1)|0 ) {
		x0 = toF(g_left + toF(toF(toF(Px|0) / toF(width|0)) * toF(g_right - g_left)));
		y0 = toF(g_bottom + toF(toF(toF(Py|0) / toF(height|0)) * toF(g_top - g_bottom)));
		x = toF(0);
		y = toF(0);
		it = 0;
		while (toF(toF(x*x) + toF(y*y)) < toF(4)) {
		    if ((it|0) >= (MAXIT|0)) break;
		    xtemp = toF(toF(toF(x*x) - toF(y*y)) + x0);
		    y = toF(toF(toF(2)*toF(x*y)) + y0);
		    x = xtemp;
		    it=(it+1)|0;
		}
		loc = imul(imul(Py|0, width|0) + Px|0, 4);
		i32[(membase+loc)>>2] = (it|0) == (MAXIT|0) ? 0xFF000000|0 : i32[(colbase+((it&7)<<2))>>2]|0;
	    }
	}
    }

    return mbrot;
}

var mandelbrot_asm =
    (function (glob) {
	var kernel;
	var buffer;
	return function (ybase, ylimit, xbase, xlimit, mem, magnification) {
	    if (!kernel) {
		buffer = mem.buffer;
		kernel = mandelbrot_asm_module(glob, {MAXIT:glob.MAXIT}, buffer);
	    }
	    else if (mem.buffer != buffer)
		throw new Error("Only one shared buffer allowed with the asm.js code");
	    return kernel(ybase, ylimit, xbase, xlimit, width, height, g_center_y, g_center_x, mem.byteOffset, colbase, magnification);
	};
    })(this);

function mandelbrot_asm_simd_module(glob, ffi, heap) {
    "use asm";

    var i32 = new glob.Int32Array(heap);
    var b8 = new glob.Uint8Array(heap);
    var aload = glob.Atomics.load; // Declare shared memory
    var imul = glob.Math.imul;
    var toF = glob.Math.fround;
    var b4 = glob.SIMD.Bool32x4;
    var i4 = glob.SIMD.Int32x4;
    var f4 = glob.SIMD.Float32x4;
    var i4add = i4.add;
    var i4and = i4.and;
    var i4lane = i4.extractLane;
    var f4add = f4.add;
    var f4sub = f4.sub;
    var f4mul = f4.mul;
    var f4lessThan = f4.lessThan;
    var f4splat = f4.splat;
    const b4Any = b4.anyTrue;
    const i4select = i4.select;
    const zero4 = i4(0,0,0,0);
    const one4 = i4(1,1,1,1);
    const two4 = f4(2,2,2,2);
    const four4 = f4(4,4,4,4);
    const MAXIT = ffi.MAXIT|0;

    function mbrot(ybase, ylimit, xbase, xlimit, width, height, g_center_y, g_center_x, membase, colbase, magnification) {
	ybase = ybase|0;
	ylimit = ylimit|0;
	xbase = xbase|0;
	xlimit = xlimit|0;
	width = width|0;
	height = height|0;
	g_center_y = toF(g_center_y);
	g_center_x = toF(g_center_x);
	membase = membase|0;
	colbase = colbase|0;
	magnification = toF(magnification);

	var g_top = toF(0);
	var g_bottom = toF(0);
	var g_left = toF(0);
	var g_right = toF(0);
	var Py = 0;
	var Px = 0;
	var x0 = f4(0,0,0,0);
	var y0 = f4(0,0,0,0);
	var x = f4(0,0,0,0);
	var y = f4(0,0,0,0);
	var mi4 = b4(0,0,0,0);
	var xsq = f4(0,0,0,0);
	var ysq = f4(0,0,0,0);
	var xtemp = f4(0,0,0,0);
	var count4 = i4(0,0,0,0);
	var it = 0;
	var loc = 0;
	var i = 0;
	var new_xbase = 0;
	var new_xlimit = 0;

	g_top = toF(g_center_y + toF(toF(1)/magnification));
	g_bottom = toF(g_center_y - toF(toF(1)/magnification));
	g_left = toF(g_center_x - toF(toF(toF(width|0) / toF(height|0)) * toF(toF(1)/magnification)));
	g_right = toF(g_center_x + toF(toF(toF(width|0) / toF(height|0)) * toF(toF(1)/magnification)));
	new_xbase = (xbase + 3) & ~3;
	new_xlimit = (xlimit & ~3);
	for ( Py=ybase ; (Py|0) < (ylimit|0) ; Py=(Py+1)|0 ) {
	    // This complication would not be needed if we knew that xbase and xlimit
	    // were properly aligned for SIMD.  See Issue #13.
	    //
	    // I'm doing loops at both edges because I can't get it to work just
	    // starting with four elements at a time from the left edge (with 3 workers).
	    // I don't understand why, there should not be any alignment issues here.
	    // Precision problems?  Seems not very likely.  Frustrated.
	    if ((new_xbase|0) != (xbase|0))
	        fallback(g_top, g_bottom, g_left, g_right, Py, xbase, new_xbase, width, height, membase, colbase);
	    if ((new_xlimit|0) != (xlimit|0))
	        fallback(g_top, g_bottom, g_left, g_right, Py, new_xlimit, xlimit, width, height, membase, colbase);
	    for ( Px=new_xbase ; (Px|0) < (new_xlimit|0) ; Px=(Px+4)|0 ) {
		x0 = f4(toF(g_left + toF(toF(toF((Px+0)|0) / toF(width|0)) * toF(g_right - g_left))),
			toF(g_left + toF(toF(toF((Px+1)|0) / toF(width|0)) * toF(g_right - g_left))),
			toF(g_left + toF(toF(toF((Px+2)|0) / toF(width|0)) * toF(g_right - g_left))),
			toF(g_left + toF(toF(toF((Px+3)|0) / toF(width|0)) * toF(g_right - g_left))));
		y0 = f4splat(toF(g_bottom + toF(toF(toF(Py|0) / toF(height|0)) * toF(g_top - g_bottom))));
		x = f4(0,0,0,0);
		y = f4(0,0,0,0);
		count4 = i4(0,0,0,0);

		for ( it = 0 ; (it|0) < (MAXIT|0) ; it = (it+1)|0) {
		    xsq = f4mul(x,x);
		    ysq = f4mul(y,y);
		    mi4 = f4lessThan(f4add(xsq, ysq), four4);
		    if (!b4Any(mi4))
			break;
		    xtemp = f4add(f4sub(xsq, ysq), x0);
		    y = f4add(f4mul(two4, f4mul(x, y)), y0);
		    x = xtemp;
		    count4 = i4add(count4, i4select(mi4, one4, zero4));
		}

		loc = imul(imul(Py|0, width|0) + Px|0 + 0, 4);
		it = i4lane(count4,0);
		i32[(membase+loc)>>2] = (it|0) == (MAXIT|0) ? 0xFF000000|0 : i32[(colbase+((it&7)<<2))>>2]|0;

		loc = imul(imul(Py|0, width|0) + Px|0 + 1, 4);
		it = i4lane(count4,1);
		i32[(membase+loc)>>2] = (it|0) == (MAXIT|0) ? 0xFF000000|0 : i32[(colbase+((it&7)<<2))>>2]|0;

		loc = imul(imul(Py|0, width|0) + Px|0 + 2, 4);
		it = i4lane(count4,2);
		i32[(membase+loc)>>2] = (it|0) == (MAXIT|0) ? 0xFF000000|0 : i32[(colbase+((it&7)<<2))>>2]|0;

		loc = imul(imul(Py|0, width|0) + Px|0 + 3, 4);
		it = i4lane(count4,3);
		i32[(membase+loc)>>2] = (it|0) == (MAXIT|0) ? 0xFF000000|0 : i32[(colbase+((it&7)<<2))>>2]|0;
	    }
	}
    }

    function fallback(g_top, g_bottom, g_left, g_right, Py, xbase, xlimit, width, height, membase, colbase) {
	g_top = toF(g_top);
	g_bottom = toF(g_bottom);
	g_left = toF(g_left);
	g_right = toF(g_right);
	Py = Py|0;
	xbase = xbase|0;
	xlimit = xlimit|0;
	width = width|0;
	height = height|0;
	membase = membase|0;
	colbase = colbase|0;
	var Px = 0;
	var x0 = toF(0);
	var y0 = toF(0);
	var x = toF(0);
	var y = toF(0);
	var it = 0;
	var xtemp = toF(0);
	var loc = 0;
	for ( Px=xbase ; (Px|0) < (xlimit|0) ; Px=(Px+1)|0 ) {
	    x0 = toF(g_left + toF(toF(toF(Px|0) / toF(width|0)) * toF(g_right - g_left)));
	    y0 = toF(g_bottom + toF(toF(toF(Py|0) / toF(height|0)) * toF(g_top - g_bottom)));
	    x = toF(0);
	    y = toF(0);
	    it = 0;
	    while (toF(toF(x*x) + toF(y*y)) < toF(4)) {
		if ((it|0) >= (MAXIT|0)) break;
		xtemp = toF(toF(toF(x*x) - toF(y*y)) + x0);
		y = toF(toF(toF(2)*toF(x*y)) + y0);
		x = xtemp;
		it=(it+1)|0;
	    }
	    loc = imul(imul(Py|0, width|0) + Px|0, 4);
	    i32[(membase+loc)>>2] = (it|0) == (MAXIT|0) ? 0xFF000000|0 : i32[(colbase+((it&7)<<2))>>2]|0;
	}
    }

    return mbrot;
}

var mandelbrot_asm_simd =
    (function (glob) {
	var kernel;
	var buffer;
	return function (ybase, ylimit, xbase, xlimit, mem, magnification) {
	    if (!kernel) {
		buffer = mem.buffer;
		kernel = mandelbrot_asm_simd_module(glob, {MAXIT:glob.MAXIT}, buffer);
	    }
	    else if (mem.buffer != buffer)
		throw new Error("Only one shared buffer allowed with the asm.js code");
	    return kernel(ybase, ylimit, xbase, xlimit, width, height, g_center_y, g_center_x, mem.byteOffset, colbase, magnification);
	};
    })(this);

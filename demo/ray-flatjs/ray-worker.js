// Generated from ray-worker.flat_js by fjsc 0.5; github.com/lars-t-hansen/flatjs
/* -*- mode: javascript -*- */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Author: Lars T Hansen, lth@acm.org / lhansen@mozilla.com
 */

importScripts("../../util/shim.js",
	      "../../src/message.js",
	      "../../src/asymmetric-barrier.js",
	      "../../src/marshaler.js",
	      "../../src/par.js",
	      "../../../flatjs/libflatjs.js",
	      "ray-common.js");

const Par = new WorkerPar();

function setup(RAW_MEMORY) {
    FlatJS.init(RAW_MEMORY, 0, RAW_MEMORY.byteLength, false);
}

var g_eye;
var g_background;
var g_light;
var g_world;
var g_bits;

function trace(xmin, xlim, ymin, ylim, eye, light, background, world, bits) {
    // Easiest to keep these in globals.
    g_eye = eye;
    g_light = light;
    g_background = background;
    g_world = world;
    g_bits = bits;
    if (g_antialias)
	traceWithAntialias(xmin, xlim, ymin, ylim);
    else
	traceWithoutAntialias(xmin, xlim, ymin, ylim);
}

function traceWithoutAntialias(ymin, ylim, xmin, xlim) {
    for ( var h=ymin ; h < ylim ; h++ ) {
	if (debug)
	    console.log("Row " + h);
	for ( var w=xmin ; w < xlim ; w++ ) {
	    var u = g_left + (g_right - g_left)*(w + 0.5)/g_width;
	    var v = g_bottom + (g_top - g_bottom)*(h + 0.5)/g_height;
	    var ray = DL3(u, v, -g_eye.z);
	    var col = raycolor(g_eye, ray, 0, SENTINEL, g_reflection_depth);
	    Bitmap.setColor(g_bits, h, w, col);
	}
    }
}

const random_numbers = [
    0.495,0.840,0.636,0.407,0.026,0.547,0.223,0.349,0.033,0.643,0.558,0.481,0.039,
    0.175,0.169,0.606,0.638,0.364,0.709,0.814,0.206,0.346,0.812,0.603,0.969,0.888,
    0.294,0.824,0.410,0.467,0.029,0.706,0.314
];

function traceWithAntialias(ymin, ylim, xmin, xlim) {
    var k = 0;
    for ( var h=ymin ; h < ylim ; h++ ) {
	//if (debug)
	//    console.log("Row " + h);
	for ( var w=xmin ; w < xlim ; w++ ) {
	    // Simple stratified sampling, cf Shirley&Marschner ch 13 and a fast "random" function.
	    const n = 4;
	    //var k = h % 32;
	    var rand = k % 2;
	    var c = DL3(0,0,0);
	    k++;
	    for ( var p=0 ; p < n ; p++ ) {
		for ( var q=0 ; q < n ; q++ ) {
		    var jx = random_numbers[rand]; rand=rand+1;
		    var jy = random_numbers[rand]; rand=rand+1;
		    var u = g_left + (g_right - g_left)*(w + (p + jx)/n)/g_width;
		    var v = g_bottom + (g_top - g_bottom)*(h + (q + jy)/n)/g_height;
		    var ray = DL3(u, v, -g_eye.z);
		    c = add(c, raycolor(g_eye, ray, 0.0, SENTINEL, g_reflection_depth));
		}
	    }
	    Bitmap.setColor(g_bits, h,w,divi(c,n*n));
	}
    }
}

// Clamping c is not necessary provided the three color components by
// themselves never add up to more than 1, and shininess == 0 or shininess >= 1.
//
// TODO: lighting intensity is baked into the material here, but we probably want
// to factor that out and somehow attenuate light with distance from the light source,
// for diffuse and specular lighting.

function raycolor(eye, ray, t0, t1, depth) {
    var tmp = Surface.intersect(g_world, eye, ray, t0, t1);
    var obj = tmp.obj;
    var dist = tmp.dist;

    if (obj) {
	const m = (obj + 8);
	const p = add(eye, muli(ray, dist));
	const n1 = Surface.normal(obj, p);
	const l1 = normalize(sub(g_light, p));
	var c = Vec3._get_impl((m + 56));
	var min_obj = NULL;

	// Passing NULL here and testing for it in intersect() was intended as an optimization,
	// since any hit will do, but does not seem to have much of an effect in scenes tested
	// so far - maybe not enough scene detail (too few shadows).
	if (g_shadows) {
	    var tmp = Surface.intersect(g_world, add(p, muli(l1, EPS)), l1, EPS, SENTINEL);
	    min_obj = tmp.obj;
	}
	if (!min_obj) {
	    const diffuse = Math.max(0.0, dot(n1,l1));
	    const v1 = normalize(neg(ray));
	    const h1 = normalize(add(v1, l1));
	    const specular = Math.pow(Math.max(0.0, dot(n1, h1)), _mem_float64[(m + 48) >> 3]);
	    c = add(c, add(mulrefi((m + 0),diffuse), mulrefi((m + 24),specular)));
	    if (g_reflection)
		if (depth > 0.0 && _mem_float64[(m + 80) >> 3] != 0.0) {
		    const r = sub(ray, muli(n1, 2.0*dot(ray, n1)));
		    c = add(c, muli(raycolor(add(p, muli(r,EPS)), r, EPS, SENTINEL, depth-1), _mem_float64[(m + 80) >> 3]));
		}
	}
	return c;
    }
    return g_background;
}

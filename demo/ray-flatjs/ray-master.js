// Generated from ray-master.flat_js by fjsc 0.5; github.com/lars-t-hansen/flatjs
/* -*- mode: javascript -*- */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Author: Lars T Hansen, lth@acm.org / lhansen@mozilla.com
 */

/*
 * Ray tracer, largely out of Shirley & Marschner 3rd Ed.
 * Traces a scene and writes to a canvas.
 *
 * This is written in FlatJS (github.com/lars-t-hansen/flatjs),
 * holding the scene graph in flat shared memory and rendering in
 * parallel into a flat shared array.  The computation is otherwise
 * straight JS and exactly the same as the sequential program.
 *
 * Parameters and FlatJS types that are shared with the worker are in
 * ray-common.flat_js.  Computation is in ray-worker.flat_js.
 */

function main() {
    const RAW_MEMORY = new SharedArrayBuffer(g_height*g_width*int32.SIZE + 65536);
    FlatJS.init(RAW_MEMORY, 0, RAW_MEMORY.byteLength, true);

    // Input: the scene graph, in shared memory
    const [eye, light, background, world] = setStage();

    //var s = "";
    //Surface.debug(world, function (x) { s += x }, 0);
    //console.log(s);
    //return;

    // Output: the bitmap, in shared memory
    const bits = Bitmap.init(Bitmap.initInstance(FlatJS.allocOrThrow(16,4)), g_height, g_width, DL3(152.0/256.0, 251.0/256.0, 152.0/256.0));

    // Note, numWorkers is set by the .html document.
    const Par = new MasterPar(new Int32Array(new SharedArrayBuffer(MasterPar.NUMINTS * Int32Array.BYTES_PER_ELEMENT)),
			      0, numWorkers, "ray-worker.js", doneParInit);

    function doneParInit() {
	Par.broadcast(doneSetup, "setup", RAW_MEMORY);
    }

    var then, now;
    function doneSetup() {
	then = Date.now();
	Par.invoke(doneTrace, "trace", [[0, g_height], [0, g_width]], eye, light, background, world, bits);
    }

    function doneTrace() {
	var now = Date.now();
	var mycanvas = document.getElementById("mycanvas");
	var cx = mycanvas.getContext('2d');
	var id  = cx.createImageData(g_width, g_height);
	id.data.set(new Uint8Array(RAW_MEMORY, _mem_int32[(bits + 4) >> 2], g_width*g_height*4));
	cx.putImageData(id, 0, 0);
	document.getElementById("mycaption").innerHTML = "Workers=" + numWorkers + ".  Time=" + (now - then) + "ms";
    }
}

// Colors: http://kb.iu.edu/data/aetf.html

const paleGreen = DL3(152.0/256.0, 251.0/256.0, 152.0/256.0);
const darkGray = DL3(169.0/256.0, 169.0/256.0, 169.0/256.0);
const yellow = DL3(1.0, 1.0, 0.0);
const red = DL3(1.0, 0.0, 0.0);
const blue = DL3(0.0, 0.0, 1.0);

function sphere(world, m, center, radius) {
    world.push(Sphere.init(Sphere.initInstance(FlatJS.allocOrThrow(128,8)), m, center, radius));
}

var splits = 0;
var level = 0;

// Triangle with edges v1 -> v2, v2 -> v3, v3 -> v1
function triangle(world, m, v1, v2, v3) {
    // If the triangle is "large", divide it to improve performance
    // with BVH.  Use the circumference as a proxy for size, and split
    // along the middle of the longest edge.
    level++;
    const TRIANGLE_CUTOFF = 0.5;  // Hacky
    //console.log(sub(v2, v1).toSource() + " " + v1.toSource() + " " + v2.toSource());
    var l1 = length(sub(v2, v1)); // v1 -> v2
    var l2 = length(sub(v3, v2)); // v2 -> v3
    var l3 = length(sub(v1, v3)); // v3 -> v1
    var c = l1 + l2 + l3;
    //console.log("Level " + level + " " + l1 + " " + l2 + " " + l3);
    // This does not work.
    if (false && level < 3 && c >= TRIANGLE_CUTOFF) {
	//console.log("Splitting: " + c);
	if (l1 > l2) {
	    // l1 > l2
	    if (l3 > l1) {
		// l3 largest so split v3 -> v1
		let mid = add(v3, divi(sub(v3, v1), 2));
		//console.log(v3.toSource() + " " + v1.toSource() + " " + mid.toSource());
		triangle(world, m, v1, v2, mid);
		triangle(world, m, mid, v2, v3);
	    }
	    else {
		// l1 largest
		let mid = add(v1, divi(sub(v2, v1), 2));
		//console.log(v1.toSource() + " " + v2.toSource() + " " + mid.toSource());
		triangle(world, m, v1, mid, v3);
		triangle(world, m, mid, v2, v3);
	    }
	}
	else {
	    // l2 >= l1
	    if (l3 > l2) {
		// l3 largest
		let mid = add(v3, divi(sub(v3, v1), 2));
		//console.log(v3.toSource() + " " + v1.toSource() + " " + mid.toSource());
		triangle(world, m, v1, v2, mid);
		triangle(world, m, mid, v2, v3);
	    }
	    else {
		// l2 largest
		let mid = add(v2, divi(sub(v3, v2), 2));
		//console.log(v2.toSource() + " " + v3.toSource() + " " + mid.toSource());
		triangle(world, m, v1, v2, mid);
		triangle(world, m, mid, v3, v1);
	    }
	}
    }
    else
	world.push(Triangle.init(Triangle.initInstance(FlatJS.allocOrThrow(192,8)), m, v1, v2, v3));
    level--;
}

// Not restricted to a rectangle, actually
function rectangle(world, m, v1, v2, v3, v4) {
    triangle(world, m, v1, v2, v3);
    triangle(world, m, v1, v3, v4);
}

// Vertices are for front and back faces, both counterclockwise as seen
// from the outside.
// Not restricted to a cube, actually.
function cube(world, m, v1, v2, v3, v4, v5, v6, v7, v8) {
    rectangle(world, m, v1, v2, v3, v4);  // front
    rectangle(world, m, v2, v5, v8, v3);  // right
    rectangle(world, m, v6, v1, v4, v7);  // left
    rectangle(world, m, v5, v5, v7, v8);  // back
    rectangle(world, m, v4, v3, v8, v7);  // top
    rectangle(world, m, v6, v5, v2, v1);  // bottom
}

function setStage() {
    if (debug)
	console.log("Setstage start");

    const zzz = DL3(0,0,0);

    const m1 = makeMaterial(DL3(0.1, 0.2, 0.2), DL3(0.3, 0.6, 0.6), 10, DL3(0.05, 0.1, 0.1), 0);
    const m2 = makeMaterial(DL3(0.3, 0.3, 0.2), DL3(0.6, 0.6, 0.4), 10, DL3(0.1,0.1,0.05),   0);
    const m3 = makeMaterial(DL3(0.1,  0,  0), DL3(0.8,0,0),     10, DL3(0.1,0,0),     0);
    const m4 = makeMaterial(muli(darkGray,0.4), muli(darkGray,0.3), 100, muli(darkGray,0.3), 0.5);
    const m5 = makeMaterial(muli(paleGreen,0.4), muli(paleGreen,0.4), 10, muli(paleGreen,0.2), 1.0);
    const m6 = makeMaterial(muli(yellow,0.6), zzz, 0, muli(yellow,0.4), 0);
    const m7 = makeMaterial(muli(red,0.6), zzz, 0, muli(red,0.4), 0);
    const m8 = makeMaterial(muli(blue,0.6), zzz, 0, muli(blue,0.4), 0);

    var world = [];

    sphere(world, m1, DL3(-1, 1, -9), 1);
    sphere(world, m2, DL3(1.5, 1, 0), 0.75);
    triangle(world, m1, DL3(-1,0,0.75), DL3(-0.75,0,0), DL3(-0.75,1.5,0));
    triangle(world, m3, DL3(-2,0,0), DL3(-0.5,0,0), DL3(-0.5,2,0));
    // This doubles tracing time because it is so large and ends up inside so many bounding
    // volumes, I bet.  With bounding volumes large triangles should be split into smaller
    // ones, and performance would generally improve (probably).  See TODO above.
    rectangle(world, m4, DL3(-5,0,5), DL3(5,0,5), DL3(5,0,-40), DL3(-5,0,-40));
    cube(world, m5, DL3(1, 1.5, 1.5), DL3(1.5, 1.5, 1.25), DL3(1.5, 1.75, 1.25), DL3(1, 1.75, 1.5),
	 DL3(1.5, 1.5, 0.5), DL3(1, 1.5, 0.75), DL3(1, 1.75, 0.75), DL3(1.5, 1.75, 0.5));
    for ( var i=0 ; i < 30 ; i++ )
	sphere(world, m6, DL3((-0.6+(i*0.2)), (0.075+(i*0.05)), (1.5-(i*Math.cos(i/30.0)*0.5))), 0.075);
    for ( var i=0 ; i < 60 ; i++ )
	sphere(world, m7, DL3((1+0.3*Math.sin(i*(3.14/16))), (0.075+(i*0.025)), (1+0.3*Math.cos(i*(3.14/16)))), 0.025);
    for ( var i=0 ; i < 60 ; i++ )
	sphere(world, m8, DL3((1+0.3*Math.sin(i*(3.14/16))), (0.075+((i+8)*0.025)), (1+0.3*Math.cos(i*(3.14/16)))), 0.025);

    var eye        = DL3(0.5, 0.75, 5);
    var light      = DL3(g_left-1, g_top, 2);
    var background = DL3(25.0/256.0,25.0/256.0,112.0/256.0);

    if (debug)
	console.log("Setstage end");

    console.log("Splits = " + splits);

    // Create bounding volume hierarchy here.  This reduces rendering
    // time by more than 50% (on first attempt).

    return [eye, light, background, partition(world, computeBounds(world), 0)];
}

function partition(surfaces, bounds, axis) {
    var left=null, right=null;
    var { xmin, xmax, ymin, ymax, zmin, zmax } = bounds;
    if (surfaces.length == 1) {
	left = surfaces[0];
	right = null;
    }
    else if (surfaces.length == 2) {
	left = surfaces[0];
	right = surfaces[1];
    }
    else {
	var mid = 0;
	var center;
	var safety = 4;
	var force = false;
	for (;;) {
	    if (!--safety) {
		// No partitioning.  Just break ties by splitting the
		// list in two arbitrarily.  We could do better
		// probably.
		force = true;
	    }
	    if (axis == 0) {
		mid = (xmax + xmin) / 2;
		center = (s) => Surface.center(s).x
	    }
	    else if (axis == 1) {
		mid = (ymax + ymin) / 2;
		center = (s) => Surface.center(s).y
	    }
	    else {
		mid = (zmax + zmin) / 2;
		center = (s) => Surface.center(s).z
	    }
	    var lobj = [];
	    var robj = [];
	    for ( var i=0 ; i < surfaces.length ; i++ ) {
		if (center(surfaces[i]) <= mid)
		    lobj.push(surfaces[i]);
		else
		    robj.push(surfaces[i]);
	    }
	    axis = (axis + 1) % 3;
	    if (robj.length && lobj.length)
		break;
	    if (force) {
		var victim = lobj.length ? lobj : robj;
		var beneficiary = lobj.length ? robj : lobj;
		for ( var i=0 ; i < Math.floor(victim.length)/2 ; i++ )
		    beneficiary.push(victim.shift());
		break;
	    }
	}
	left = lobj.length == 1 ? lobj[0] : partition(lobj, computeBounds(lobj), axis);
	right = robj.length == 1 ? robj[0] : partition(robj, computeBounds(robj), axis);
    }
    return Volume.init(Volume.initInstance(FlatJS.allocOrThrow(152,8)), xmin, xmax, ymin, ymax, zmin, zmax, left, right);
}

function computeBounds(surfaces) {
    var bounds = surfaces.map((s) => Surface.bounds(s));
    return { xmin: Math.min.apply(null, bounds.map((b) => b.xmin)),
	     xmax: Math.max.apply(null, bounds.map((b) => b.xmax)),
	     ymin: Math.min.apply(null, bounds.map((b) => b.ymin)),
	     ymax: Math.max.apply(null, bounds.map((b) => b.ymax)),
	     zmin: Math.min.apply(null, bounds.map((b) => b.zmin)),
	     zmax: Math.max.apply(null, bounds.map((b) => b.zmax)) };
}


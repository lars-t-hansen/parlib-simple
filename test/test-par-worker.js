/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

importScripts("../util/shim.js",
	      "../src/message.js",
	      "../src/asymmetric-barrier.js",
	      "../src/marshaler.js",
	      "../src/par.js");

var Par = new WorkerPar();

var height = 0;
var width = 0;
var aux;

function setParameters(_height, _width, _aux) {
    height = _height;
    width = _width;
    aux = _aux;
}

function computeStep(hmin, hmax, wmin, wmax, mem, a, b) {
    var n = aux[Par.self];
    for ( var h=hmin ; h < hmax ; h++ )
	for ( var w=wmin ; w < wmax ; w++ )
	    mem[h*width+w] += fudge(a+b+n);
}

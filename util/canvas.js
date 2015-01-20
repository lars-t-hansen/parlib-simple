/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Utilities for simple manipulation of canvas elements.

function canvasSetFromGrayscale(canvasElt, bytes, height, width) {
    canvasElt.height = height;
    canvasElt.width = width;
    var cx = canvasElt.getContext('2d');
    var id  = cx.createImageData(width, height);
    var data = new Int32Array(id.data.buffer, id.data.byteOffset, width*height);
    for ( var y=0 ; y < height ; y++ ) {
	for ( var x=0 ; x < width ; x++ ) {
	    var v = bytes[y*width+x] & 255;
	    data[y*width+x] = 0xFF000000 | (v << 16) | (v << 8) | v;
	}
    }
    cx.putImageData( id, 0, 0 );
}

// Caching is not all that important I think, and of course we're holding on to stuff here,
// but it helps when doing animations and for that case it's realistic to cache things.
const cache = { element: null, cx: null, id: null, height: 0, width: 0 };

function canvasSetFromABGRBytes(canvasElt, bytes, height, width) {
    if (cache.element != canvasElt || cache.height != height || cache.width != width) {
	canvasElt.height = height;
	canvasElt.width = width;
	cache.element = canvasElt;
	cache.height = height;
	cache.width = width;
	cache.cx = canvasElt.getContext('2d');
	cache.id = cache.cx.createImageData(width, height);
    }
    cache.id.data.set(bytes);
    cache.cx.putImageData( cache.id, 0, 0 );
}

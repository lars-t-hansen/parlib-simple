/*
 * Copyright (c) 2011, Intel Corporation
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * - Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 * - Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 *
 */

"use strict";

var globalParams;		// Initialized elsewhere

// Shared kernel for renderWorld sequential and worker-parallel code.
// Apart from the parameter passing and the destructuring of
// globalParams, this is identical to the original sequential code.

function MineKernel(ylo, ylim, xlo, xlim, result, yCos, ySin, xCos, xSin, ox, oy, oz) {
    var { w, h, map, texmap } = globalParams;

    for ( var x=xlo ; x < xlim ; x++ ) {
	var ___xd = (x - w / 2) / h;
	for ( var y=ylo ; y < ylim ; y++ ) {
	    var __yd = (y - h / 2) / h;
	    var __zd = 1;

	    var ___zd = __zd * yCos + __yd * ySin;
	    var _yd = __yd * yCos - __zd * ySin;

	    var _xd = ___xd * xCos + ___zd * xSin;
	    var _zd = ___zd * xCos - ___xd * xSin;

	    var col = 0;
	    var br = 255;
	    var ddist = 0;

	    var closest = 32;
	    for ( var d = 0; d < 3; d++) {
		var dimLength = _xd;
		if (d == 1)
		    dimLength = _yd;
		if (d == 2)
		    dimLength = _zd;

		var ll = 1 / (dimLength < 0 ? -dimLength : dimLength);
		var xd = (_xd) * ll;
		var yd = (_yd) * ll;
		var zd = (_zd) * ll;

		var initial = ox - (ox | 0);
		if (d == 1)
		    initial = oy - (oy | 0);
		if (d == 2)
		    initial = oz - (oz | 0);
		if (dimLength > 0)
		    initial = 1 - initial;

		var dist = ll * initial;

		var xp = ox + xd * initial;
		var yp = oy + yd * initial;
		var zp = oz + zd * initial;

		if (dimLength < 0) {
		    if (d == 0)
			xp--;
		    if (d == 1)
			yp--;
		    if (d == 2)
			zp--;
		}

		while (dist < closest) {
		    var tex = map[(zp & 63) << 12 | (yp & 63) << 6 | (xp & 63)];

		    if (tex > 0) {
			var u = ((xp + zp) * 16) & 15;
			var v = ((yp * 16) & 15) + 16;
			if (d == 1) {
			    u = (xp * 16) & 15;
			    v = ((zp * 16) & 15);
			    if (yd < 0)
				v += 32;
			}

			var cc = texmap[u + v * 16 + tex * 256 * 3];
			if (cc > 0) {
			    col = cc;
			    ddist = 255 - ((dist / 32 * 255) | 0);
			    br = 255 * (255 - ((d + 2) % 3) * 50) / 255;
			    closest = dist;
			}
		    }
		    xp += xd;
		    yp += yd;
		    zp += zd;
		    dist += ll;
		}
	    }

	    var r = ((col >> 16) & 0xff) * br * ddist / (255 * 255);
	    var g = ((col >> 8) & 0xff) * br * ddist / (255 * 255);
	    var b = ((col) & 0xff) * br * ddist / (255 * 255);

            result[(x + y * w) * 4 + 0] = r;
            result[(x + y * w) * 4 + 1] = g;
            result[(x + y * w) * 4 + 2] = b;
	}
    }
}

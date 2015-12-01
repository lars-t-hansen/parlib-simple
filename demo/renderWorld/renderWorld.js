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

var World = function() {
    this.xRot = 0;
    this.yRot = 0;
    this.ySin = 0;
    this.xCos = 0;
    this.xSin = 0;
    this.ox = 0;
    this.oy = 0;
    this.oz = 0;
    this.MODE = "seq";
    this.overlap = document.getElementById("overlapcheck").checked;

    this.w = 250 * 2;
    this.h =  128 * 2;
    this.len = this.w * this.h;
    this.start_time = Date.now();
    this.time_window = 500;
    this.ticks = new Float64Array(this.time_window);
    this.next = 0;

    this.map = null;
    this.texmap = null;

    this.map = new Float32Array(new SharedArrayBuffer(64 * 64 * 64 * Float32Array.BYTES_PER_ELEMENT));
    this.texmap = new Float32Array(new SharedArrayBuffer(16 * 16 * 3 * 16 * Float32Array.BYTES_PER_ELEMENT));
    this.frames = 0;
    this.sharedResultArrays = null;	// Will be initialized when needed
    this.numResultArrays = 2;		// 1 or more
    this.whichResultArray = 0;

    this.ctx = document.getElementById('game').getContext('2d');
    document.getElementById("togglebutton").onclick = this.toggleExecutionMode.bind(this);
    document.getElementById("headlessbutton").onclick = this.toggleHeadlessMode.bind(this);
    document.getElementById("overlapcheck").onclick = this.toggleOverlap.bind(this);
    this.init();
}

// Misc hacks
var HANDLER;
var READY = false;
var CALLBACK_PENDING = false;
var HEADLESS = false;
var Par = null;

World.prototype.toggleHeadlessMode = function () {
    if (HEADLESS)
        document.getElementById("headlessbutton").innerHTML = "Disable display";
    else
        document.getElementById("headlessbutton").innerHTML = "Enable display";
    HEADLESS = !HEADLESS;
}

World.prototype.toggleExecutionMode = function () {
    this.start_time = Date.now();
    this.ticks = new Float64Array(this.time_window);
    this.next = 0;
    this.frames = 0;

    switch(this.MODE) {
    case "seq":
        this.MODE = "workers";
	this.initializeWorkers();
        document.getElementById("togglebutton").innerHTML = "Go Sequential";
	document.getElementById("overlapcheck").disabled = false;
	break;
    case "workers":
	this.MODE = "seq";
        document.getElementById("togglebutton").innerHTML = "Go Parallel";
	document.getElementById("overlapcheck").disabled = true;
	break;
    }
    return false;
}

World.prototype.toggleOverlap = function () {
    this.overlap = document.getElementById("overlapcheck").checked;
}

World.prototype.initializeWorkers = function () {
    if (this.sharedResultArrays != null)
	return;

    var INTSZ = Int32Array.BYTES_PER_ELEMENT;
    var sab = new SharedArrayBuffer((this.w*this.h*this.numResultArrays + MasterPar.NUMINTS)*INTSZ);

    this.sharedResultArrays = [];
    for ( var i=0 ; i < this.numResultArrays ; i++ ) {
	var mem = this.sharedResultArrays[i] = new Uint8Array(sab, i*(this.w*this.h*INTSZ), this.w*this.h*INTSZ);
	// Initialize the Alpha value
	for ( var j=0 ; j < this.w*this.h ; j++ )
	    mem[j*4+3] = 0xFF;
    }

    var meta = new Int32Array(sab, this.w*this.h*this.numResultArrays*INTSZ, MasterPar.NUMINTS);
    this.Par = new MasterPar(meta,
			     0,
			     numWorkers,
			     "renderWorld-worker.js",
			     () => {
				 this.Par.broadcast(() => { READY=true; },
						    "Setup",
						    this.w, this.h, this.map, this.texmap);
			     });
}

World.prototype.init = function() {
    var map = this.map;
    var texmap = this.texmap;
    var w = this.w;
    var h = this.h;

    for ( var i = 1; i < 16; i++) {
        var br = 255 - ((Math.random() * 96) | 0);
        for ( var y = 0; y < 16 * 3; y++) {
            for ( var x = 0; x < 16; x++) {
                var color = 0x966C4A;
                if (i == 4)
                    color = 0x7F7F7F;
                if (i != 4 || ((Math.random() * 3) | 0) == 0) {
                    br = 255 - ((Math.random() * 96) | 0);
                }
                if ((i == 1 && y < (((x * x * 3 + x * 81) >> 2) & 3) + 18)) {
                    color = 0x6AAA40;
                } else if ((i == 1 && y < (((x * x * 3 + x * 81) >> 2) & 3) + 19)) {
                    br = br * 2 / 3;
                }
                if (i == 7) {
                    color = 0x675231;
                    if (x > 0 && x < 15
                            && ((y > 0 && y < 15) || (y > 32 && y < 47))) {
                        color = 0xBC9862;
                        var xd = (x - 7);
                        var yd = ((y & 15) - 7);
                        if (xd < 0)
                            xd = 1 - xd;
                        if (yd < 0)
                            yd = 1 - yd;
                        if (yd > xd)
                            xd = yd;

                        br = 196 - ((Math.random() * 32) | 0) + xd % 3 * 32;
                    } else if (((Math.random() * 2) | 0) == 0) {
                        br = br * (150 - (x & 1) * 100) / 100;
                    }
                }

                if (i == 5) {
                    color = 0xB53A15;
                    if ((x + (y >> 2) * 4) % 8 == 0 || y % 4 == 0) {
                        color = 0xBCAFA5;
                    }
                }
                if (i == 9) {
                    color = 0x4040ff;
                }
                var brr = br;
                if (y >= 32)
                    brr /= 2;

                if (i == 8) {
                    color = 0x50D937;
                    if (((Math.random() * 2) | 0) == 0) {
                        color = 0;
                        brr = 255;
                    }
                }

                var col = (((color >> 16) & 0xff) * brr / 255) << 16
                    | (((color >> 8) & 0xff) * brr / 255) << 8
                    | (((color) & 0xff) * brr / 255);
                texmap[x + y * 16 + i * 256 * 3] = col;
            }
        }
    }

    for ( var x = 0; x < 64; x++) {
        for ( var y = 0; y < 64; y++) {
            for ( var z = 0; z < 64; z++) {
                var i = z << 12 | y << 6 | x;
                var yd = (y - 32.5) * 0.4;
                var zd = (z - 32.5) * 0.4;
                map[i] = (Math.random() * 16) | 0;
                if (Math.random() > Math.sqrt(Math.sqrt(yd * yd + zd * zd)) - 0.8)
                    map[i] = 0;
            }
        }
    }

    this.pixels = this.ctx.createImageData(w, h);
    var da = this.pixels.data;

    for ( var i = 0; i < w * h; i++) {
        da[i * 4 + 3] = 255;
    }

    HANDLER = this.clock.bind(this);
    if (!CALLBACK_PENDING) {
	CALLBACK_PENDING = true;
	setTimeout(HANDLER, 0);
    }
};

World.prototype.updateTickParams = function () {
    this.xRot = Math.sin(Date.now() % 10000 / 10000 * Math.PI * 2) * 0.4
        + Math.PI / 2;
    this.yRot = Math.cos(Date.now() % 10000 / 10000 * Math.PI * 2) * 0.4;
    this.yCos = Math.cos(this.yRot);
    this.ySin = Math.sin(this.yRot);
    this.xCos = Math.cos(this.xRot);
    this.xSin = Math.sin(this.xRot);
    this.ox = 32.5 + Date.now() % 10000 / 10000 * 64;
    this.oy = 32.5;
    this.oz = 32.5;
    this.frames++;
}

World.prototype.renderWorldWorkers = function(start_time) {
    this.updateTickParams();
    var mem = this.sharedResultArrays[this.whichResultArray];
    this.whichResultArray = (this.whichResultArray + 1) % this.numResultArrays;
    this.Par.invoke(this.renderWorldWorkersK.bind(this, mem, start_time),
		    "MineKernel", [[0,this.h],[0,this.w]],
		    mem,
		    this.yCos, this.ySin, this.xCos, this.xSin, this.ox, this.oy, this.oz);
}

World.prototype.renderWorldWorkersK = function (mem, start_time) {
    var started = false;

    // Start another rendering while we're displaying this one?  The
    // test on MODE is to handle mode switching properly.
    if (this.overlap && this.numResultArrays > 1 && this.MODE == "workers") {
	started = true;
	this.renderWorldWorkers(Date.now());
    }

    // Display the result.
    this.copyToPixels(mem);
    this.renderFrame(start_time);

    if (!started) {
	CALLBACK_PENDING = true;
	setTimeout(HANDLER, 0);
    }
}

World.prototype.copyToPixels = function(s) {
    // set() is slow when copying from shared to unshared (a bug), so
    // unroll the copy.  (One wonders if doing the copy on int32
    // arrays rather than on byte arrays would be an improvement.)
    var t = this.pixels.data;
    for ( var p=0, lim=s.length ; p < lim ; p++ )
	t[p] = s[p];
    this.result = null;
}

var globalParams;		// { w, h, map, texmap } - for the sequential program; MineKernel reads this

World.prototype.renderWorldSequential = function() {
    if (!globalParams)
	globalParams = this;
    this.updateTickParams();
    MineKernel(0, this.h, 0, this.w, this.pixels.data, this.yCos, this.ySin, this.xCos, this.xSin, this.ox, this.oy, this.oz);
}

World.prototype.clock = function () {
    CALLBACK_PENDING = false;
    var start_time = Date.now();
    switch (this.MODE) {
    case "seq":
        this.renderWorldSequential();
	this.renderFrame(start_time);
	CALLBACK_PENDING = true;
	setTimeout(HANDLER, 0);
	break;

    case "workers":
	// Hack to deal with not-ready workers during startup
	if (!READY) {
	    CALLBACK_PENDING = true;
	    setTimeout(HANDLER, 10);
	    return;
	}
        this.renderWorldWorkers(start_time);
	break;
    }
}

World.prototype.renderFrame = function (start_time) {
    if (!HEADLESS)
	this.ctx.putImageData(this.pixels, 0, 0);

    var n = (this.next + 1) % this.time_window;
    var x = this.ticks[n];
    var y = Date.now() - this.start_time;
    var time_elapsed = y - x;
    var frames = Math.min(this.frames, this.time_window);
    this.next = n;
    this.ticks[n] = y;

    var cs = this.MODE == "workers" ? (numWorkers + " ") : "";
    if(Date.now() - this.start_time > 1000) {
        document.getElementById("fps").innerHTML = cs + this.MODE + "  " + Math.floor((frames*1000)/time_elapsed) + " fps (last 500 frames)";
    }
    else {
        document.getElementById("fps").innerHTML = cs + this.MODE + "  " + "-- fps (last 500 frames)";
    }
}

function init() {
    var t = new World();
}


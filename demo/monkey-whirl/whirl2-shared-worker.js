// Simple striping.

onmessage =
    function (ev) {
	if (ev.data === "start") return;
	var [memIn, memOut, height, width, ymin, ylim, rotation] = ev.data;
	whirl(height, width, ymin, ylim, rotation,
	      new SharedInt32Array(memIn),
	      new SharedInt32Array(memOut));
	postMessage("done");
    };

function whirl(height, width, ymin, ylim, rotation, dataIn, dataOut) {
    var r = Math.floor((Math.max(width,height)-1)/2);
    var Cx = Math.floor((width-1)/2);
    var Cy = Math.floor((height-1)/2);

    for ( var y=ymin ; y < ylim ; y++ ) {
	for ( var x=0 ; x < width ; x++ ) {
	    var iny = 0;
	    var inx = 0;
	    var distance = Math.sqrt((y-Cy)*(y-Cy) + (x-Cx)*(x-Cx));
	    var alpha = Math.atan2(y-Cy, x-Cx);
	    var R = distort(-rotation, distance, r);
	    iny = clamp(0,Cy+Math.floor(Math.sin(alpha + R)*distance),height-1);
	    inx = clamp(0,Cx+Math.floor(Math.cos(alpha + R)*distance),width-1);
	    // Here we could sample the neighborhood of the source pixel, which would
	    // allow for higher quality in distorted regions.
	    dataOut[y*width + x] = dataIn[iny*width + inx];
	}
    }
}

// Given a nominal rotation and a distance and the radius, return a
// new, possibly smaller, rotation; it should shrink as the distance
// increases toward r.

function distort(rotation, distance, r) {
    // Some kind of exponential might do better.
    return rotation * (r-distance)/r;
}

function clamp(lower, x, upper) {
    if (x < lower) return lower;
    if (x > upper) return upper;
    return x;
}


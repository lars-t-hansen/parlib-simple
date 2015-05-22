// whirl2, with shared memory.

const workers = [];

for ( var i=0 ; i < numWorkers ; i++ ) {
    var w = new Worker("whirl2-shared-worker.js");
    w.postMessage(["start"]);	// Warmup
    workers.push(w);
}

var canvas = document.getElementById('canvas');
var ctx = canvas.getContext('2d');

var img = document.getElementById('image')
canvas.width = img.width;
canvas.height = img.height;
ctx.drawImage(img, 0, 0, img.width, img.height);

var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
var imgOut = ctx.createImageData(canvas.width, canvas.height);
var width = imgData.width;
var height = imgData.height;
var dataIn = imgData.data;

var sharedDataIn = new SharedInt32Array(dataIn.length/4);
var sharedDataOut = new SharedInt32Array(dataIn.length/4);

// memcpy(), surely there's a better way?
var view = new Int32Array(dataIn.buffer);
for ( var i=0 ; i < view.length ; i++ )
    sharedDataIn[i] = view[i];

var running = false;

function onWhirl() {
    running = !running;
    if (running)
	whirlTest();
}

function whirlTest() {
    //var results = document.getElementById('whirl-result');
    //results.innerHTML = "Running test...";

    window.setTimeout(function() {

	var remaining = numWorkers;
	var distortion = 0;
	var delta = Math.PI / 30;

	function frame() {
	    distortion += delta;
	    if (Math.abs(distortion) > 2*Math.PI)
		delta = -delta;

	    var i=0;
	    var y=0;
	    var sliceHeight = Math.floor(height/numWorkers);

	    for ( var w of workers ) {
		var nexty = (i==numWorkers-1) ? height : y+sliceHeight;
		w.postMessage([sharedDataIn.buffer, sharedDataOut.buffer, height, width, y, nexty, distortion],
			      [sharedDataIn.buffer, sharedDataOut.buffer]);
		y = nexty;
	    }
	}

	for ( var w of workers )
	    w.onmessage = function() {
		if (--remaining > 0)
		    return;
		var dataOut = imgOut.data;

		// memcpy(), surely there's a better way?
		var view = new Int32Array(dataOut.buffer);
		for ( var i=0 ; i < view.length ; i++ )
		    view[i] = sharedDataOut[i];

		//var finishTime = Date.now() - startTime;
		ctx.putImageData(imgOut, 0, 0);
		remaining = numWorkers;
		if (running)
		    setTimeout(frame, 0);
	    };

	frame();
    }, 10);
}

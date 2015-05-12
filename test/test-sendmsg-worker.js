importScripts("../src/arena.js",
	      "../src/synchronic.js",
	      "../src/marshaler.js",
	      "../src/intqueue.js",
	      "../src/channel.js");

onmessage =
    function (ev) {
	var [sab, iterations] = ev.data;

	var r = new ChannelReceiver(sab, 0, 4096);
	var s = new ChannelSender(sab, 4096, 4096);

	postMessage("ready");

	var c = {item:-1};
	for ( var i=0 ; i < iterations ; i++ ) {
	    c = r.receive();
	    c.item++;
	    s.send(c);
	}

	console.log("worker exiting");
    };

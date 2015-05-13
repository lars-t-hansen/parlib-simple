/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

importScripts("../src/arena.js",
	      "../src/synchronic.js",
	      "../src/marshaler.js",
	      "../src/intqueue.js",
	      "../src/channel.js");

onmessage =
    function (ev) {
	var [_, id, sab, iterations] = ev.data;
	console.log("setting up " + id);
	s = new ChannelSender(sab, 0, 4096);
	r = new ChannelReceiver(sab, 4096, 4096);
	onmessage =
	    function firstSibling(ev) {
		console.log("running " + id);
		var c = {item:0};
		var start;
		for ( var i=0 ; i < iterations ; i++ ) {
		    s.send(c);
		    if (i == 0)
			start = Date.now();
		    c = r.receive();
		}
		var time = (Date.now() - start);
		console.log("Time: " + time + "ms, perf=" + Math.round((iterations*2) / (time / 1000)) + " msg/s");
		console.log("worker " + id + " exiting");
	    };
	postMessage("ready");
    };

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
	var r = new ChannelReceiver(sab, 0, 4096);
	var s = new ChannelSender(sab, 4096, 4096);
	onmessage =
	    function (ev) {
		console.log("running " + id);
		for ( var i=0 ; i < iterations ; i++ ) {
		    var c = r.receive();
		    c.item++;
		    s.send(c);
		}
		console.log("worker " + id + " exiting");
	    };
	postMessage("ready");
    };

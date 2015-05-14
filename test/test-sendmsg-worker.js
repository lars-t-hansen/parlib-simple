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
	var [sab, iterations, recvIdx, recvLength, sendIdx, sendLength] = ev.data;

	// Initialize our state

	var r = new ChannelReceiver(sab, recvIdx, recvLength);
	var s = new ChannelSender(sab, sendIdx, sendLength);

	// Let the master know we're ready to go

	postMessage("ready");

	var c = {item:-1};
	for ( var i=0 ; i < iterations ; i++ ) {
	    c = r.receive();
	    c.item++;
	    s.send(c);
	}

	console.log("Worker exiting");
    };

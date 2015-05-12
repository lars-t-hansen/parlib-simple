// Test the message channel in ../src/channel.js.

load("../src/arena.js");
load("../src/synchronic.js");
load("../src/intqueue.js");
load("../src/marshaler.js");
load("../src/channel.js");

// Basic test

var sab = new SharedArrayBuffer(4096); // Keep it short for better testing

var q = new ChannelSender(sab, 0, sab.byteLength);

setSharedArrayBuffer(sab);

var iterations = 10000;

evalInWorker(
`
load("../src/arena.js");
load("../src/synchronic.js");
load("../src/intqueue.js");
load("../src/marshaler.js");
load("../src/channel.js");

var iterations=${iterations};
var sab = getSharedArrayBuffer();
var q = new ChannelReceiver(sab, 0, sab.byteLength);

for ( var i=0 ; i < iterations ; i++ ) {
    var v = q.receive();
    assertEq(v.ho, i);
    var w = v.hi;
    for ( var j=0 ; j < w.length ; j++ )
	assertEq(w[j], i+j);
    assertEq(typeof v.abner, "string");
    assertEq(v.abner, ""+i);
}
`);

for ( var i=0 ; i < iterations ; i++ ) {
    q.send({hi:[i,i+1,i+2,i+3,i+4], ho:i, abner:i+""});
}

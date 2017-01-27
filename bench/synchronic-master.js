/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This is the "simplest possible" message passing benchmark: it has
// one integer location for data and one for synchronization, and two
// workers use synchronic operations on the sync location to
// coordinate access to the data location.

var iterations = 1000000;

var bufSize = 1024;
var syncOffset = 512;
var polyOffset = 800;
var workOffset = 0;
var sab = new SharedArrayBuffer(bufSize);

for ( var i=0 ; i < 2 ; i++ ) {
    var w = new Worker("synchronic-worker.js");
    w.onmessage = function (ev) { msg(ev.data) }
    w.postMessage([sab, syncOffset, workOffset, polyOffset, iterations, i]);
}

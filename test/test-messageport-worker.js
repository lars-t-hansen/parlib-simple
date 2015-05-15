/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var port;

onmessage = stage1;

function stage1(ev) {
    var iterations = ev.data[0]; // Ignored, here
    port = ev.data[1];
    port.onmessage = stage2;
    port.postMessage("ready");
};

function stage2(ev) {
    var c = ev.data;
    c.item++;
    port.postMessage(c);
}

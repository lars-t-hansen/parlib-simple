/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

onmessage = stage1;

function stage1(ev) {
    var iterations = ev.data[0];
    onmessage = stage2;
    postMessage("ready");
};

function stage2(ev) {
    var c = ev.data;
    c.item++;
    postMessage(c);
}

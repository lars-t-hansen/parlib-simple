/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Simple output abstraction.  Call 'msg(s)' to print s in a message view.

document.write("<div id='scrool'></div>");
const scrool = document.getElementById("scrool");

function msg(s) {
    var d = document.createElement("div");
    d.appendChild(document.createTextNode(s));
    scrool.appendChild(d);
}

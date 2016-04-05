/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

importScripts("../util/shim.js");

function msg(s) {
    postMessage(s);
}

function assertEqual(expect, got) {
    // Too simple
    if (expect !== got)
	throw new Error("Error: Expected " + expect + " but got " + got);
}

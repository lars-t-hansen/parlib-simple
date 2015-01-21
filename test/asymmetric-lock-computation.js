/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Compute something, in a noisy way
function compute() {
    var r = 0;
    var c = Math.random() * 100;
    for ( var i=0 ; i < c ; i++ )
	r += Math.random();
    return r;
}

// Stay for a while
function mangleResult(r) {
    while (r > 3) {
	r = Math.sqrt(r);
    }
    return r;
}

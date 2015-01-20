/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Determine the number of workers

const defaultNumWorkers = 4;
const numWorkers =
  (function () {
      if (!this.document || !document.location)
	  return defaultNumWorkers;
      var param=String(document.location).match(/workers=(\d+)/);
      if (!param)
	  return defaultNumWorkers;
      return parseInt(param[1]);
  })();

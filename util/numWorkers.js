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

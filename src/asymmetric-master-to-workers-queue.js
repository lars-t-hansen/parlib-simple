// Queue for sending data from one master to multiple workers through
// shared memory.
//
// The master is nonblocking: an enqueue call may fail, in which case
// the master will receive a callback when there is space available.
//
// This is probably easily implementable using a synchronic?  Suppose
// there's a synchronic that holds the number of available elements.
// Then:
//
//   function put(q, items) {
//     if (q.put(items))
//       return;
//     let cb = function () {
//       let v = q.freeCount().get();
//       if (q.put(items))
//         return;
//       q.freeCount().expectUpdate(cb, v);
//     }
//     cb();
//   }

MasterMWsQueue.prototype.enqueue = function (items) {
}

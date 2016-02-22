Some simple benchmarks for JS shared memory and atomics.

The performance aspects we can test are these:

* Simple atomic operations such as load, store, compareExchange, add.
  The performance is primarily affected by type inference and inlining
  in the JIT, subsequently by loop and flow optimizations applied to
  the code that results: hoisting and commoning of checks (range
  checks, checks that the memory is shared), removal of unnecessary
  barriers, and probably alias analysis.
* Wait and Wake operations (futex operations now, synchronic operations later).
  We can measure the cost of various kinds of synchronization patterns that
  require the workers to go into wait/wake operations.


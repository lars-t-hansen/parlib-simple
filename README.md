# parlib-simple

This is a simple library providing synchronization and work
distribution abstractions, assuming as little as possible about the
client code (and thus providing minimal help with data abstraction and
so on).  The fact that shared memory is provided as flat arrays of
primitive values is exposed in all constructors, for example.

(**NOTE**, at present these require a slightly patched Firefox to run.  See
https://github.com/lars-t-hansen/atomics-queue for instructions.)

The data structures provided here are:

* locks and condition variables (lock.js)
* multi-producer multi-consumer bounded buffer (buffer.js)
* barrier synchronization (barrier.js)
* shared-memory "bump" memory allocator (bump-alloc.js)
* load-balancing data parallel framework (par.js)
* asymmetric master/worker barrier synchronization (asymmetric-barrier.js)
* atomics polyfill for SharedFloat64Array (float64atomics.js)

See doc/ for tutorials, etc.

See demo/ for some programs that use these data structures.

See test/ for more programs, not tutorial in nature, that use these
data structures.
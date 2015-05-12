# parlib-simple

This is a simple library providing synchronization and work
distribution abstractions, assuming as little as possible about the
client code (and thus providing minimal help with data abstraction and
so on).  The fact that shared memory is provided as flat arrays of
primitive values is exposed in all constructors, for example.

These all work in Firefox Nightly.

Each file usually lists the other files it needs to be included.

See doc/ for tutorials, etc.

See demo/ for some programs that use these data structures.

See test/ for more programs, not tutorial in nature, that use these
data structures.

## High level facilities

* load-balancing data parallel framework (par.js)
* messaging systems with value marshaling (channel.js)
* signaling facility for atomic values (synchronic.js)
* multi-producer multi-consumer bounded buffer (buffer.js)

## Low-level facilities

* classical locks and condition variables (lock.js)
* barrier synchronization (barrier.js)
* shared-memory "bump" memory allocator (bump-alloc.js)
* asymmetric master/worker barrier synchronization (asymmetric-barrier.js)
* atomics polyfill for SharedFloat64Array (float64atomics.js)
* atomics polyfill for "int64" values on SharedInt32Array (int32atomics.js)
* shared-memory queue for bundles of integer values (intqueue.js)
* marshaling and unmarshaling of values (marshaler.js)
* simple allocation superstructure for array buffers (arena.js)

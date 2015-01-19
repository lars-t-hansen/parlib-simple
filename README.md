# parlib-simple

This is a simple library providing synchronization abstractions,
assuming as little as possible about the client code (and thus
providing minimal help with data abstraction and so on).  The fact
that shared memory is provided as flat arrays of primitive values is
exposed in all constructors, for example.

The data structures provided here are:

* locks and condition variables (lock.js)
* multi-producer multi-consumer bounded buffer (buffer.js)
* symmetric barrier synchronization (barrier.js)
* shared-memory "bump" memory allocator (bump-alloc.js)
* asymmetric master/worker barrier synchronization (asymmetric-barrier.js)

## Allocating and initializing shared memory

Most of the data structures use the following pattern.

Generally, the shared memory that will be used by a data type, eg
`Lock`, will need to be allocated and initialized before the
agent-local objects of that type are allocated onto that shared
memory: there will be many objects, one in each agent, mapping to the
same piece of shared memory.

You can allocate the memory yourself, or use the provided allocator.
In either case the number of shared int32 locations needed for the
data type is given by the constructor's `NUMINTS` property, eg,
`Lock.NUMINTS`.

```js
var lockLoc = myInt32AllocPointer;
myInt32AllocPointer += Lock.NUMINTS;
```

Once the memory has been allocated you must call the constructor's
`initialize()` memory on it:

```js
Lock.initialize(mySharedInt32Array, lockLoc);
```

Finally, the data type is instantiated (several times, one in each
agent) using *new*:

```js
var lock = new Lock(mySharedInt32Array, lockLoc);
```

## The allocator

With the allocator, allocation and initialization are easily combined,
since `initialize()` returns its second argument:

```js
var lockLoc = Lock.initialize(alloc.Int32Array, alloc.allocInt32(Lock.NUMINTS)));
```

Other reasons for using the allocator is that it works across agents,
so memory can be allocated somewhat dynamically in the shared heap
from multiple agents without coordination.

## TODO

Add to this repo the `Multicore` object from sab-demo/util.

Also, rename `Multicore` to something more appropriate, remove the
need for the explicit output parameter, and merge the master and worker
files.

Also, can we factor out the value marshaling used by `Multicore` into
something that can be used in other contexts?

Also, we should provide a memory allocator that allows memory to be
freed on an object-by-object basis.  Bonus points for something that
has better performance than what we currently have (which requires a
CAS per allocation).

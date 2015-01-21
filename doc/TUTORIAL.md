# Using parlib-simple

## Symmetric and asymmetric data types

*Symmetric* data types are those that do not distinguish between the
agents participating.  For example, `Barrier` just knows that a number
of agents will enter and once they have they will be released.

*Asymmetric* data types distinguish between the *Master* and the
*Workers* (and where the master is almost always the window's main
thread).  For example, `MasterBarrier` and `WorkerBarrier` comprise
an asymmetric barrier where the master gets a callback when the
workers are all in the barrier.

The purpose of asymmetric data types is to enable computations that
don't block the window's main thread.


## Allocating and initializing shared memory

All the data types represent JS objects that are completely local to a
single realm (the main thread or a worker).  However, the data types
all need a little private storage in shared memory, shared among
several instances of the data type.

For constructors that take a SharedInt32Array as the first parameter
the amount of shared storage is published on the data type as the
`NUMINTS` property, eg, `Lock.NUMINTS`.  The second parameter to the
constructor is then invariably the index of the first location in the
integer array that is reserved for that object.  The program must
manage that memory explicitly, though it can use a utility allocator
class for that (see below).

Symmetric and asymmetric data structures initialize that shared
storage differently.

The symmetric data structures have a static `initialize()` method that
must be called on the memory once, before any objects are constructed
on the memory.  All agents use the same constructor.

The asymmetric data structures instead have two constructors, one for
the master side and one for the worker side, and the master
constructor initializes the shared memory (and must always return
before any worker constructors are called).


## The allocator

There is a data type, `BumpAlloc`, that provides simple memory
allocation services.  It is initialized with a SharedArrayBuffer and
can be used to allocate ranges of words in that buffer.  It works
across multiple agents and is thread-safe.

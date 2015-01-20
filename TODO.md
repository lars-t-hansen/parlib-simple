# TODO

## The library

Test cases for the bump allocator.

Rename SharedBumpAlloc to BumpAlloc, the longer name is redundant.

Can/should BumpAlloc hew closer to the initialize-then-allocate
pattern used elsewhere?

Can/should MasterBarrier/WorkerBarrier hew closer to the
initialize-then-allocate pattern used elsewhere?

We should provide a memory allocator that allows memory to be freed on
an object-by-object basis.  Bonus points for something that has better
performance than what we currently have (which requires a CAS per
allocation).

Add to this repo the `Multicore` object from sab-demo/util.

Also, rename `Multicore` to something more appropriate, remove the
need for the explicit output parameter, and merge the master and
worker files so that fewer files have to be included.

Also, can we factor out the value marshaling used by `Multicore` into
something that can be used in other contexts?

## The demos

Want a larger demo that shows off the bump allocator.

Want to import something that shows off the Multicore object.

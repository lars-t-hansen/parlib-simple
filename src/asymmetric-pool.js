// This is a data structure called an "ItemPool", as used by the Par
// framework:
//
//  - it is of fixed size
//  - it has no callbacks to signal available space or available data
//  - it is master -> workers
//  - it can store multiple "items" each comprised of multiple "values"
//  - the number of values per item is fixed
//
// Basically it is used for shipping bundles of items to the workers,
// with coordination of work external to the pool.
//
// It *may* be easy to extend that to variable size.  Suppose the
// itemSize is 0.  Then every item is prefixed with its value count.
// That needs to be exposed for the blitting function, sigh, or
// perhaps reserve is invalid then.
//
// n = *next
// l = *limit
// if (n >= l) exit // this could fail spuriously unless l is read-only (*limit might have been updated)
// v = buf[n]       // this could read stale data unless buf is read-only (*next might have been updated)
// ;; n+v <= l
// vs = buf[n+1], buf[n+2], ...
// if (CAS(next, n, n+v)) return success with vs
// else redo
//
// So as long as we have clear phases where l is either fixed or in
// the worst case moves only forward, a lock-free algorithm seems
// possible.  (And then the buffer can be reset.)  But for a circular
// buffer it's hard, as we have multiple words participating in the
// transaction.  We may be able to push l and n into one CASable word,
// but the item header will be separate.

// Suppose the 'meta' word contains:
//  - next
//  - limit
//  - size
// and each item ends with a word that contains the size of the next
// element (so this needs to be patched when the next element is
// installed, and to be zero until then).

// ;; distinguished shared location known as 'meta' contains index and size of next item
// ;; if size is zero then there is no next item
// ;; otherwise we read the item and the word after it, which contains the size of
// ;; the next item, or zero
// ;; appending to an empty queue means updating first the queue, then the metaword
// ;; appending to a nonempty queue means updating just the queue
//
// do {
//   m = *meta
//   n, size = scatter(m)
//   if size == 0 then exit
//   vs = buf[n], buf[n+1], buf[n+2], ...
// } while (CAS(*meta, m, gather(n+size, vs[size-1])) != m)
//

function MasterItemPool(iab, ibase, itemSize, numItems) {
    this.iab = iab;
    this.ibase = ibase;

    const itemSizeIdx = ibase;	  // Values per item
    const itemNextIdx = ibase+1;  // Extract here
    const itemLimIdx = ibase+2;	  // Insert here
    const bufferLimIdx = ibase+4; // Limit for insertion
}

MasterItemPool.NUMINTS = ...;

// This returns true if the element was inserted, false if the buffer
// was full.

MasterItemPool.prototype.put =
    function (values) {
    };

// Allocate space for the number of items and return the index of
// the first item.

MasterItemPool.prototype.reserve =
    function (numItems) {
    };

function WorkerItemPool(iab, ibase) {
    this.iab = iab;
    this.ibase = ibase;

}

// This returns null if extraction is not possible, otherwise
// a fresh Array of the values extracted.

WorkerItemPool.prototype.take =
    function () {
    };

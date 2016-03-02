// A polyfill of futexes on top of synchronics.
//
// Not finished but clearly plausible.

// List nodes

var _FUL_next = 0;
var _FUL_prev = 1;
var _FUL_INTS = 2;

// Wait info nodes (allocated)

var _FUW_wait = 0;		// synchronics wait on this loc
var _FUW_G = 1;			// node ID part 1: G
var _FUW_addr = 2;		// node ID part 2: offset
var _FUW_node_OFFS = 3;
var _FUW_next = _FUW_node_OFFS + _FUL_next;
var _FUW_prev = _FUW_node_OFFS + _FUL_prev;
var _FUW_INTS = _FUW_node_OFFS + _FUL_INTS;

// Wait info nodes (free)

var _FUF_nextFree = 0;

// Offsets within the futex's data store

var _FU_lock = 0;		           // Lock word
var _FU_node_OFFS = 1;		           // In-line list node
var _FU_first = _FU_node_OFFS + _FUL_next; //   First element in double circular list
var _FU_last = _FU_node_OFFS + _FUL_prev;  //   Second element in double circular list
var _FU_free = _FU_node_OFFS + _FUL_INTS;  // Free list of nodes
var _FU_alloc = _FU_free + 1;		   // Allocation pointer
var _FU_INTS = _FU_alloc + 1;

var Futex =
{
    // We need to reserve this many bytes for our workspace.
    //
    // Really this depends on the number of workers, we need one _FUW
    // node per worker, maximum, plus some overhead.

    BYTE_SIZE: 4096,

    // "sab" is any SharedArrayBuffer.
    // "offset" is divisible by 4.
    // We will use memory from offset through offset+BYTE_SIZE-1.

    setup: function (sab, offset) {
	let _ia = new Int32Array(sab, offset, this.BYTE_SIZE/4);
	this._ia = _ia;
	_ia[_FU_lock] = 0;
	_ia[_FU_first] = _FU_node_OFFS;
	_ia[_FU_last] = _FU_node_OFFS;
	_ia[_FU_free] = 0;
	_ia[_FU_alloc] = _FU_INTS;
    },

    // "sab" is a SharedArrayBuffer.
    // "tag" is a nonnegative integer less than 2^20.
    //
    // This will tag the buffer with with the tag, for our later
    // internal use.
    //
    // If two SharedArrayBuffer objects reference the same memory then
    // those two objects MUST have the same tag.  That's true whether
    // the two objects are in the same agent or different agents.
    // (They can be in the same agent if a SAB was transfered to
    // another agent and back again.)
    //
    // If two SharedArrayBuffer objects do not reference the same
    // memory then they MUST NOT have the same tag.

    tagBuffer: function (sab, tag) {
	if (sab.hasOwnProperty("_address_free_id") && sab._address_free_id != tag)
	    throw new Error("SharedArrayBuffer has already been tagged with a different tag");
	sab._address_free_id = tag;
    },

    // ia is some shared Int32Array
    // loc is a valid location within that array
    // value is the value we want to be in that location before blocking
    // timeout is, if not undefined, the millisecond timeout

    wait: function (ia, loc, value, timeout) {
	let G = this._identifier(ia.buffer);
	let addr = ia.bufferOffset + loc*4;
	let _ia = this._ia;

	this._lock();
	if (ia[loc] != value) {
	    this._unlock();
	    return this.NOTEQUAL;
	}
	let w = this._allocNode();
	if (!w) {
	    this._unlock();
	    throw new Error("Out of futex memory");
	}
	_ia[w + _FUW_G] = G;
	_ia[w + _FUW_addr] = addr;
	_ia[w + _FUW_wait] = 0;
	{
	    // FIXME: this needs to go in back!
	    let first = _ia[_FU_first];
	    let node = w + _FUW_node_OFFS;
	    _ia[node + _FUL_next] = first;
	    _ia[node + _FUL_prev] = _FU_node_OFFS;
	    _ia[_FU_first] = node;
	    _ia[first + _FUL_prev] = node;
	}
	this._unlock();

	let r = this.OK;
	Atomics.expectUpdate(_ia, w + _FUW_wait, 0, timeout);
	if (_ia[w + _FUW_wait] == 0)
	    r = this.TIMEDOUT;

	this._lock();
	{
	    let prev = _ia[node + _FUL_prev];
	    let next = _ia[node + _FUL_next];
	    _ia[next + _FUL_prev] = prev;
	    _ia[prev + _FUL_next] = next;
	}
	this._freeNode(w);
	this._unlock();

	return r;
    },

    wake: function (ia, loc, count) {
	let G = this._identifier(ia.buffer);
	let addr = ia.bufferOffset + loc*4;
	let _ia = this._ia;
	this._lock();
	if (count === undefined)
	    count = 0x7FFFFFFF;
	else
	    count = count|0;
	let woken = 0;
	for ( let l = _ia[_FU_first] ; l && count > 0 ; l = _ia[l + _FUL_next] ) {
	    let node = l - _FUW_node_OFFS;
	    if (_ia[node + _FUW_G] == G && _ia[node + _FUW_addr] == addr) {
		if (_ia[node + _FUW_wait] == 0) {
		    Atomics.storeNotify(_ia, node + _FUW_wait, 1);
		    count--;
		    woken++;
		}
	    }
	}
	this._unlock();
	return woken;
    },

    wakeOrRequeue: function (ia, loc1, count, loc2, value) {
    },

    OK: 0,
    NOTEQUAL: -1,
    TIMEDOUT: -2,

    _ia: null,

    _identifier: function (sab) {
	// Lock not held, and not needed
	if (!sab.hasOwnProperty("_address_free_id"))
	    throw new Error("SharedArrayBuffer has not been tagged");
	return sab._address_free_id;
    },

    _lock: function () {
	while (Atomics.compareExchange(this._ia, _FU_lock, 0, 1) == 1)
	    Atomics.expect(this._ia, _FU_lock, 0);
    },

    _unlock: function () {
	Atomics.storeNotify(this._ia, _FU_lock, 0, true);
    },

    _allocNode: function (G, loc) {
	// Lock held
	let _ia = this._ia;
	let p = _ia[_FU_free];
	if (p) {
	    _ia[_FU_free] = _ia[p + _FUF_nextFree];
	    return p;
	}
	let alloc = _ia[_FU_alloc];
	if (alloc + _FUW_INTS > this.BYTE_SIZE/4)
	    return 0;
	p = alloc;
	_ia[_FU_alloc] += _FUW_INTS;
	return p;
    },

    _freeNode: function (w) {
	// Lock held
	let _ia = this._ia;
	_ia[w + _FUF_nextFree] = _ia[_FU_free];
	_ia[_FU_free] = w;
    }
}

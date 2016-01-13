// Asymmetric bounded integer queue data types.
//
// MasterProducerIntQueue sends int32 bundles from the master to the
// workers.
//
// WorkerProducerIntQueue sends int32 bundles from the workers to the
// master.
//
// Data is communicated as bundles of int32 values (an "item").  The
// item is something that has a length property and responds to
// indexed getters.  When extracting data from the queue, the type
// returned is an Array.
//
//
// MasterProducerIntQueue producer API:
//
//  q.putOrFail(item) => true if the item was inserted, false if not
//  q.callWhenCanPut(itemSize, callback) => true if callback was invoked directly, otherwise false
//
// MasterProducerIntQueue consumer API:
//
//  q.canTake() => true if an item is available
//  q.takeOrFail() => item or null
//  q.take() => item, blocks until available
//
//
// WorkerProducerIntQueue producer API:
//
//  q.putOrFail(item) => boolean
//  q.put(item) => undefined, blocks until space is vailable
//
// WorkerProducerIntQueue consumer API:
//
//  q.canTake() => true if an item is available
//  q.takeOrFail() => item or null
//  q.callWhenCanTake(callback) => true if callbck was invoked directly, otherwise false


// Implementation:
//
// I is the insertion pointer: the circular buffer index of the last
// element of the last item inserted.
//
// R is the removal pointer: the circular buffer index of the first
// element of the oldest item still in the buffer.
//
//   There is at least one empty element in the queue at I+1.  The
//   queue is empty iff I==R, and it is (completely) full iff
//   (I+1)%size==R.
//
//   There is only one master, which updates I exclusively.  There can
//   be many workers, all of which contend to update R.
//
// INS is a producer->consumer synchronic that is used for signaling
// insertions, ideally only when the queue goes from empty to nonempty.
//
// REM is a consumer->producer synchronic that is used for signaling
// removals (always, since the queue is often not "full", it just can't
// accomodate a new item).
//
//   Neither synchronic is tracking the number of elements in the
//   queue, they're just signals.
//
// WOR is a worker<->worker synchronic that's used as a latch to create
// a critical section for removal.  R is updated atomically, but only
// while the latch is held.
//
// Memory layout:
//                     I                                    R
// +------+-----------------------------------------------------------+
// |(meta)|ddddHdddddddd                                    HddddddHdd|
// +------------------------------------------------------------------+
//
// where meta contains I, R, INS, and REM.

// Critique:
//
// This is sort of dumb - at most it optimizes the message sending to
// the master and hides the futex mess for the workers.  But since
// there's not a count anywhere, how does anyone wait on anything?  I
// guess on the insertion side we would do:
//
//   - while there's not space
//       await removal signal
//
// On the removal side we would do:
//
//   - while there are no elements to remove
//      await insertion signal [this is where we want notifyOne]
//
// FUTURE WORK ITEM:
//
// It points to a situation in an ASYMMETRIC synchronic where the
// receiver of the signal may want to update the synchronic's value to
// account for the signal having been received.

const _MPIQ_I = 0;
const _MPIQ_R = _MPQ_I + 4;
const _MPIQ_INS = align(_MPQ_R + 4, SynchronicMasterUpdates.BYTE_ALIGN);
const _MPIQ_REM = align(_MPQ_INS + SynchronicMasterUpdates.BYTE_SIZE, SynchronicWorkerUpdates.BYTE_ALIGN);
const _MPIQ_WOR = align(_MPQ_REM + SynchronicWorkerUpdates.BYTE_SIZE, Synchronic.BYTE_ALIGN);
const _MPIQ_BUF = align(_MPQ_WOR + Synchronic.BYTE_SIZE, 4);

const _MPIQ_INSERT = _MPQI_I >> 2;
const _MPIQ_REMOVE = _MPQI_R >> 2;

function MasterProducerIntQueue(sab, offset, numBytes, isMaster) {
    this._ia = new Int32Array(sab, offset, numBytes >> 2);
    this._smu = new SynchronicMasterUpdates(sab, offset + _MPIQ_INS, isMaster, 0);
    this._swu = new SynchronicWorkerUpdates(sab, offset + _MPIQ_REM, isMaster, 0);
    if (isMaster) {
	Atomics.store(this._ia, _MPIQ_INSERT, 0);
	Atomics.store(this._ia, _MPIQ_REMOVE, 0);
    }
    else {
	this._latch = new Synchronic(sab, offset + _MPIQ_WOR);
    }
}

/**
 * The amount of space needed for the MasterProducerQueue for its
 * internal data structures.  Any additional space should be divisible
 * by 4 (for integer data) and will be used for the buffer.
 */
MasterProducerIntQueue.BYTE_SIZE = _MPQ_BUF + 4; // 4 extra for the gap element

/**
 * The required byte alignment, divisible by 4, no larger than 16.
 */
MasterProducerIntQueue.BYTE_ALIGN = Math.max(SynchronicMasterUpdates.BYTE_ALIGN,
					     SynchronicWorkerUpdates.BYTE_ALIGN,
					     Synchronic.BYTE_ALIGN);

// Implementation uses this fact

MasterProducerIntQueue.IMMEDIATE = SynchronicWorkerUpdates.IMMEDIATE;
MasterProducerIntQueue.DELAYED = SynchronicWorkerUpdates.DELAYED;

/**
 * Insert the item if possible, and return true if so.  Otherwise
 * return false.
 */
MasterProducerIntQueue.prototype.putOrFail = function (item) {
    let buffer = this._buffer;
    let size = this._size;
    let insert = Atomics.load(buffer[this._INSERT]);
    let remove = Atomics.load(buffer[this._REMOVE]);
    let avail = insert <= remove ? remove-insert-1 : size-(insert-remove)-1;

    if (avail < item.length + 1)
	return false;

    buffer[insert] = item.length;
    insert = (insert + 1) % size;
    for ( let i=0 ; i < item.length ; i++ ) {
	buffer[insert] = item[i];
	insert = (insert + 1) % size;
    }

    this._smu.add(1);

    return true;
}

/**
 * Invoke callback when there's space available in the queue for an
 * item of length itemSize.  The callback is invoked with a value
 * indicating when it was called: MasterProducerIntQueue.IMMEDIATE if
 * it was invoked immediately, MasterProducerIntQueue.DELAYED if it
 * was invoked later.
 *
 * Returns true if the callback was invoked immediately, otherwise
 * false.
 *
 * Typical usage here would be to call callWhenCanPut with a thunk
 * that calls putOrFail on the same item and asserts if that fails.
 */
MasterProducer.prototype.callWhenCanPut = function (itemSize, callback) {
    let buffer = this._buffer;
    let size = this._size;
    let swu = this._swu;
    let check = (when) => {
	let tag = swu.load();
	let insert = Atomics.load(buffer[_MPIQ_INSERT]);
	let remove = Atomics.load(buffer[_MPIQ_REMOVE]);
	let avail = insert <= remove ? remove-insert-1 : size-(insert-remove)-1;
	if (avail < itemSize + 1)
	    return swu.callWhenNotEquals(tag, check);
	callback(when);
	return true;
    }
    return check(MasterProducerIntQueue.IMMEDIATE);
}

MasterProducerIntQueue.prototype.canTake = function () {
    let buffer = this._buffer;
    let insert = Atomics.load(buffer[_MPIQ_INSERT]);
    let remove = Atomics.load(buffer[_MPIQ_REMOVE]);
    return insert != remove;
}

MasterProducerIntQueue.prototype.takeOrFail = function () {
    let buffer = this._buffer;
    let latch = this._latch;
    let insert = Atomics.load(buffer, _MPIQ_INSERT);
    while (!latch.compareExchange(0,1))
	latch.waitUntilEquals(0);
    let remove = Atomics.load(buffer, _MPIQ_REMOVE);
    if (insert == remove) {
	latch.store(0);
	return false;
    }
    let n = buffer[remove];
    let item = [];
    while (n > 0) {
	item.push(buffer[_MPQ_DATA + remove]);
	remove = (remove + 1) % size;
    }
    Atomics.store(buffer, _MPIQ_REMOVE, remove);
    latch.store(0);
    this._swu.add(1);
    return item;
}

MasterProducerIntQueue.prototype.take = function () {
    for (;;) {
	let tag = this._smu.load();
	let item = this.takeOrFail();
	if (item)
	    return item;
	this._smu.waitForUpdate(tag);
    }
}

// Double-ended asymmetric bounded master/worker queue.

// Single integers only, for now (MasterIntBuffer/WorkerIntBuffer)

// Multiple workers can read from and write to the worker end of the
// buffer.

// iab must be a SharedInt32Array
// ibase must be the first of MasterBuffer.NUMINTS locations in iab dedicated
//   to this MasterBuffer.
// dbase must be the first of dsize locations in iab dedicated to this MasterIntBuffer.
// ebase must be the first of esize locations in iab dedicated to this MasterIntBuffer.
//
// The dbase/dsize locations are used for Master->Worker
// communication, they will contain directives and marshaled data.
//
// The ebase/esize locations are used for Worker->Master
// communication, ditto.
//
// The buffer is bounded, so size esize and dsize appropriately.
//
// If only one-way communication is desired then pass zero for
// dbase/dsize or ebase/esize, as appropriate.

function MasterIntBuffer(iab, ibase, dbase, dsize, ebase, esize) {
    const dbaseIdx = ibase;
    const dsizeIdx = ibase+1;
    const ebaseIdx = ibase+2;
    const esizeIdx = ibase+3;
    const downAvailIdx = ibase+4;
    const downExtractIdx = ibase+5;
    const downInsertIdx = ibase+6;
    const upAvailIdx = ibase+7;
    const upExtractIdx = ibase+8;
    const upInsertIdx = ibase+9;
    const wbLockIdx = ibase+10;
    const wbCondIdx = wbLockIdx + Lock.NUMINTS;
}

MasterIntBuffer.NUMINTS = 11 + Lock.NUMINTS + Cond.NUMINTS;

// cb is called when there's an item in the input queue
MasterIntBuffer.prototype.setItemCallback =
    function (cb) {
    };

// cb is called when there's more space available in the output queue
MasterIntBuffer.prototype.setSpaceCallback =
    function (cb) {
    };

MasterIntBuffer.prototype.tryPut =
    function (item) {
    };

MasterIntBuffer.prototype.tryTake =
    function () {
	var avail = Atomics.load(this.iab, upAvailIdx);
	if (avail == 0)
	    return false;
	// The extract pointer for the up items is not racy
	// because there's at least one item in the queue.  But we
	// can't decrement the avail count until we've extracted
	// the item.
	var upExtractPtr = this.iab[upExtractIdx];
	// TODO: what we don't have here is a sense of modulo-buffer-size...  How
	// to handle that?  Special OOB marshal value?  We can check it here, and if -1 (say)
	// then reset pointer to the start of the buffer.  Sender just pads buffer with -1.
	//
	// TODO: unmarshalOne will be very useful (and not hard).
	var { value, pointer } = this._marshaler.unmarshalOne(this.iab, upExtractPtr);
	this.iab[upExtractPointer] = pointer;
	// TODO: if a worker is blocked space then wake him.  But how?
	Atomics.sub(this.iab, upAvailIdx, 1);
	return value;
    }

function WorkerIntBuffer(iab, ibase) {
}

WorkerIntBuffer.prototype.put =
    function (item) {
	// If the up stream is full then we must block, and register
	// that we are blocked, and when the master extracts an item
	// it must wake us up.  It may be that futexes are sufficient
	// for that, so that we don't need locks or conds.
    };

WorkerIntBuffer.prototype.take =
    function () {
	const iab = this.iab;
	const downAvailIdx = ibase+4;
	const downExtractIdx = ibase+5;
	const downInsertIdx = ibase+6;

	// Fast path - prevents contending workers from having to
	// block.  Probably too complicated?

	var avail = Atomics.load(iab, downAvailIdx);
	if (avail > 0) {
	    if (Atomics.compareExchange(iab, downAvailIdx, avail, avail-1) == avail) {
		do {
		    var idx = Atomics.load(iab, downExtractIdx);
		    var value = Atomics.load(iab, idx);
		} while (Atomics.compareExchange(iab, downExtractIdx, idx, idx+1 % ...) == idx);
		return value;
	    }
	}

	// This requires the master to be able to signal on a
	// condition without holding the lock, or requires it to run
	// tryLock in a loop.  Neither is great.

	this.lock.lock();
	while (iab[downAvailIdx] == 0)
	    this.nonempty.wait();
	...;
	this.lock.unlock();
	return value;
    };

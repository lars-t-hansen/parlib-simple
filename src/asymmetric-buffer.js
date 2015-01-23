// Double-ended asymmetric bounded master/worker queue.

// iab must be a SharedInt32Array
// ibase must be the first of MasterBuffer.NUMINTS locations in iab dedicated
//   to this MasterBuffer.
// dbase must be the first of dsize locations in iab dedicated to this MasterBuffer.
// ebase must be the first of esize locations in iab dedicated to this MasterBuffer.
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

function MasterBuffer(iab, ibase, dbase, dsize, ebase, esize) {
    const dbaseIdx = ibase;
    const dsizeIdx = ibase+1;
    const ebaseIdx = ibase+2;
    const esizeIdx = ibase+3;
    const availIdx = ibase+4;
    const downExtractIdx = ibase+5;
    const downInsertIdx = ibase+6;
    const upExtractIdx = ibase+7;
    const upInsertIdx = ibase+8;
    const wbLockIdx = ibase+9;
    const wbCondIdx = wbLockIdx + Lock.NUMINTS;
}

MasterBuffer.NUMINTS = 10 + Lock.NUMINTS + Cond.NUMINTS;

// cb is called when there's an item in the input queue
MasterBuffer.prototype.setItemCallback =
    function (cb) {
    };

// cb is called when there's more space available in the output queue
MasterBuffer.prototype.setSpaceCallback =
    function (cb) {
    };

MasterBuffer.prototype.tryPut =
    function (item) {
    };

MasterBuffer.prototype.tryTake =
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

function WorkerBuffer(iab, ibase) {
}

WorkerBuffer.prototype.put =
    function (item) {
	// If the up stream is full then we must block, and register
	// that we are blocked, and when the master extracts an item
	// it must wake us up.  It may be that futexes are sufficient
	// for that, so that we don't need locks or conds.
    };

WorkerBuffer.prototype.take =
    function () {
    };

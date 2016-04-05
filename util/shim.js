// Big API changes in March 2016:
//
// - Atomics.futexWait renamed as Atomics.wait
// - Atomics.futexWake renamed as Atomics.wake
// - Atomics.wake returns strings, not integers
// - Atomics.OK removed
// - Atomics.TIMEDOUT removed
// - Atomics.NOTEQUAL removed
// - Atomics.futexWakeOrRequeue removed
//
// This shim converts an older browser to the new system.

if (Atomics.wait === undefined) {
    if (Atomics.OK === undefined)
	Atomics.wait = Atomics.futexWait;
    else
	Atomics.wait = (function (futexWait, OK, TIMEDOUT, NOTEQUAL) {
	    return function (ia, idx, val, t) {
		switch (futexWait(ia, idx, val, t)) {
		case OK : return "ok";
		case TIMEDOUT : return "timed-out";
		case NOTEQUAL : return "not-equal";
		}
	    }
	})(Atomics.futexWait, Atomics.OK, Atomics.TIMEDOUT, Atomics.NOTEQUAL);
}

if (Atomics.wake === undefined)
    Atomics.wake = Atomics.futexWake;

delete Atomics.OK;
delete Atomics.TIMEDOUT;
delete Atomics.NOTEQUAL;
delete Atomics.futexWait;
delete Atomics.futexWake;
delete Atomics.futexWakeOrRequeue;

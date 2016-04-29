// This locking code is specialized for the benchmarks and can be
// customized in several ways, tweak the constants below.
//
// To test the impact of eagerly calling wake(), move the call to
// this._wake() in unlock() out of the conditional.  Normally you want
// withCounting to be false in that case.

// Set withPause to true to use Atomics.pause to avoid going into Atomics.wait.
// Requires the patch that defines Atomics.pause.

const withPause = false;

// Set withCounting to true to use a counter for the number of waiters to avoid
// calling Atomics.wake.

const withCounting = false;

function Lock(ia, offs) {
    this.ia = ia;
    this.offs = offs;
}

Lock.init = function (ia, offs) {
    Atomics.store(ia, offs, 0);	  // lockState
    Atomics.store(ia, offs+1, 0); // numWaiters (optimization)
    Atomics.store(ia, offs+2, 0); // numWaits (for profiling)
}

Lock.prototype.lock = function () {
    let ia = this.ia;
    let offs = this.offs;
    let c = 0;
    if ((c = Atomics.compareExchange(ia, offs, 0, 1)) != 0) {
        do {
            if (c == 2 || Atomics.compareExchange(ia, offs, 1, 2) != 0)
		this._wait();
        } while ((c = Atomics.compareExchange(ia, offs, 0, 2)) != 0);
    }
};

Lock.prototype.unlock = function () {
    let ia = this.ia;
    let offs = this.offs|0;
    let c = Atomics.sub(ia, offs, 1);
    if (c != 1) {
        //Atomics.store(ia, offs, 0);
        Atomics.exchange(ia, offs, 0); // A lot faster, bug 1077027
	this._wake();
    }
};

function waitPauseCounting() {
    let ia = this.ia;
    let offs = this.offs;
    let i=0;
    while (Atomics.pause(i++))
    	if (Atomics.load(ia, offs) != 2)
    	    return;
    Atomics.add(ia, offs+1, 1);
    Atomics.add(ia, offs+2, 1);  // Profiling
    Atomics.wait(ia, offs, 2);
    Atomics.sub(ia, offs+1, 1);
}

function wakePauseCounting() {
    let ia = this.ia;
    let offs = this.offs;
    if (Atomics.load(ia, offs+1) > 0)
        Atomics.wake(ia, offs, 1);
}

function waitPause() {
    let ia = this.ia;
    let offs = this.offs;
    let i=0;
    while (Atomics.pause(i++))
    	if (Atomics.load(ia, offs) != 2)
    	    return;
    Atomics.add(ia, offs+2, 1);  // Profiling
    Atomics.wait(ia, offs, 2);
}

function wakePause() {
    let ia = this.ia;
    let offs = this.offs;
    Atomics.wake(ia, offs, 1);
}

function waitCounting() {
    let ia = this.ia;
    let offs = this.offs;
    Atomics.add(ia, offs+1, 1);
    Atomics.add(ia, offs+2, 1);  // Profiling
    Atomics.wait(ia, offs, 2);
    Atomics.sub(ia, offs+1, 1);
}

function wakeCounting() {
    let ia = this.ia;
    let offs = this.offs;
    if (Atomics.load(ia, offs+1) > 0)
        Atomics.wake(ia, offs, 1);
}

function wait() {
    let ia = this.ia;
    let offs = this.offs;
    Atomics.add(ia, offs+2, 1);  // Profiling
    Atomics.wait(ia, offs, 2);
}

var wake = wakePause;

Lock.prototype._wait = (function () {
    if (pause && counting)
	return waitPauseCounting;
    if (pause)
	return waitPause;
    if (counting)
	return waitCounting;
    return wait;
})();

Lock.prototype._wake = (function () {
    if (pause && counting)
	return wakePauseCounting;
    if (pause)
	return wakePause;
    if (counting)
	return wakeCounting;
    return wake;
})();


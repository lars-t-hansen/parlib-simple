function roundupAsmJSHeapLength(nbytes) {
    const sixteen = 16*1024*1024;
    if (nbytes < 65536) {
	// Must be at least 64KB
        nbytes = 65536;
    }
    if (nbytes < sixteen) {
        // Must be power of 2
        var k = 0;
        while (nbytes != 1) {
            if (nbytes & 1)
                nbytes += 1;
            k++;
            nbytes >>= 1;
        }
        nbytes <<= k;
    }
    else if (nbytes % sixteen) {
        // Must be multiple of 16M
        nbytes = (nbytes + (sixteen - 1)) & ~(sixteen - 1);
    }
    return nbytes;
}

Demo programs showcasing the various features of the library.

* mandelbrot-animation is a Mandelbrot set animation built on the asymmetric-barrier.
* mandelbrot-animation2 is a Mandelbrot set animation built on the Par framework.  It gets better performance than the simple program by automatically tiling the computation, and by overlapping computation and display.
* mandelbrot-animation-simd [OBSOLETE] is the same as mandelbrot-animation2 but using asm.js for the kernel and optionally SIMD to compute multiple pixels at a time.  asm.js by itself does not improve the performance over straight Javascript, but simd boosts the performance by a factor of 1.8.  However, since it uses float and not double it has lower quality at high magnification levels.  [Obsolete because shared memory and SIMD are no longer available in asm.js in Firefox]
* renderWorld is a benchmark program authored by Intel (originally for Parallel Javascript testing), computing and displaying a flight over a Minecraft-like landscape.  It can be run both on the main thread and in workers, using the Par framework.

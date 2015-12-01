// Center the image at this location.
const g_center_x = -0.743643887037158704752191506114774;
const g_center_y = 0.131825904205311970493132056385139;

// Pixel grid.  (0,0) correspons to (bottom,left)
const height = 480;
const width = 640;

// Max iterations.  This is referenced as a property on the global
// object, so can't be "const".
var MAXIT = 200;

// The Intel Mandelbrot SIMD demo uses these:
// const height = 400;
// const width = 600;
// const MAXIT = 100;

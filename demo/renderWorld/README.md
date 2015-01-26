This program was written by Intel for the purpose of testing PJS.  I
have rewritten it by removing the PJS code and reusing the same kernel
function for the sequential and workers case (PJS had to have a
somewhat different kernel), and done some other minor cleanup.

I have added a facility for overlapping computation and display using
the workers.

I have also rewritten the calculation of frame rate, to allow for
overlapping the display of one frame with the computation of the next
(in parallel mode), and to track a window of frames, not all
computation since the start.  As a result, the frame rate is not
compatible with the frame rate computed by the original program.  (The
original program computed a frame rate that did not include the time
to display the frame, but excluding the display time makes it
impossible to see the real speedup from overlapping computation and
display.)

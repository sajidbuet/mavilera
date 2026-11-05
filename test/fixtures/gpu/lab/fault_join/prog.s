# fault_join -- a join with nothing on the reconvergence stack: the core must
# stop with fault code 4 (join on an empty stack) and leave memory unchanged.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. All rights reserved.
    .include "simt.inc"
    .text
    .globl _start
_start:
    li     t0, 1
    split  t0                 # uniform: pushes one reconverge entry
    join                      # pops it
    join                      # the stack is empty: must fault here
    li     t1, 99
    sw     t1, 0(zero)        # never reached
    tmc    zero

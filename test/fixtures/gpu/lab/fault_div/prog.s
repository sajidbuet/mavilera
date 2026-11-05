# fault_div -- a conditional branch on per-thread data without split: the
# odd lanes would take it and the even lanes would not, so the core must
# stop with fault code 1 (divergent branch) and leave memory unchanged.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. All rights reserved.
    .include "simt.inc"
    .text
    .globl _start
_start:
    csrr   t0, LANE_ID
    andi   t0, t0, 1          # 1 in odd lanes
    beqz   t0, 1f             # divergent: must fault here
    li     t1, 99
    sw     t1, 0(zero)        # never reached
1:  tmc    zero

# ifelse8 -- the kernel of ifelse on ONE warp of EIGHT lanes (the machine of
# the chapter's worked example; testbench tb_rvsimt_l8, LANES = 8,
# WARPS = 1), so that the cycles compare directly with the masks-only count.
# Argument block at KERNEL_ARGS: n, x, y.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. All rights reserved.
    .include "simt.inc"
    .text
    .globl _start
_start:
    csrr   a0, KERNEL_ARGS
    lw     a1, 4(a0)          # x
    lw     a2, 8(a0)          # y
    csrr   t0, THREAD_INDEX
    slli   t0, t0, 2
    add    a1, a1, t0
    add    a2, a2, t0
    lw     t1, 0(a1)          # x[i]
    slt    t0, t1, zero       # p := (x < 0)
    split  t0
    beqz   t0, else
    sub    t2, zero, t1       # then: v := -x
    srai   t2, t2, 1          #       v := v / 2
    sub    t2, zero, t2       #       v := -v
    j      endif
else:
    slli   t2, t1, 1          # else: v := 2x
    add    t2, t2, t1         #       v := 3x
endif:
    join
    sw     t2, 0(a2)          # y[i] := v
    tmc    zero

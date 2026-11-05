# ifelse -- y[i] := 3 x[i] if x[i] >= 0, else x[i] / 2 rounded towards zero,
# for the eight threads of two warps. One split, a uniform beqz, the
# then-path (x < 0, three instructions), the else-path (two instructions)
# and one join at the reconvergence point.
# Argument block at KERNEL_ARGS: n, x, y.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. All rights reserved.
    .include "simt.inc"
    .text
    .globl _start
_start:
    li     t0, 2              # two warps
    lui    t1, %hi(kernel)
    addi   t1, t1, %lo(kernel)
    wspawn t0, t1
kernel:
    csrr   a0, KERNEL_ARGS
    lw     a1, 4(a0)          # x
    lw     a2, 8(a0)          # y
    csrr   t0, THREAD_INDEX
    slli   t0, t0, 2
    add    a1, a1, t0
    add    a2, a2, t0
    lw     t1, 0(a1)          # x[i]
    slt    t0, t1, zero       # p := (x < 0)
    split  t0                 # then-path first for the threads with p = 1
    beqz   t0, else           # uniform: every active thread agrees
    sub    t2, zero, t1       # then: v := -x
    srai   t2, t2, 1          #       v := v / 2
    sub    t2, zero, t2       #       v := -v
    j      endif
else:
    slli   t2, t1, 1          # else: v := 2x
    add    t2, t2, t1         #       v := 3x
endif:
    join                      # first pass: to the else threads; second: reconverge
    sw     t2, 0(a2)          # y[i] := v
    tmc    zero

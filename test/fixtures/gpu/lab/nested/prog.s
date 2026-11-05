# nested -- y[i] := 2 if x[i] < -4, 1 if -4 <= x[i] < 0, 0 if x[i] >= 0,
# with a split inside the then-path of another split (stack depth 4).
# Argument block at KERNEL_ARGS: n, x, y.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. All rights reserved.
    .include "simt.inc"
    .text
    .globl _start
_start:
    li     t0, 2
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
    slt    t0, t1, zero       # outer p := (x < 0)
    split  t0
    beqz   t0, nonneg
    slti   t3, t1, -4         # inner p := (x < -4)
    split  t3
    beqz   t3, small
    li     t2, 2              # x < -4
    j      inner_end
small:
    li     t2, 1              # -4 <= x < 0
inner_end:
    join
    j      outer_end
nonneg:
    li     t2, 0              # x >= 0
outer_end:
    join
    sw     t2, 0(a2)
    tmc    zero

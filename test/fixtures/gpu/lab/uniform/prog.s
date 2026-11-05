# uniform -- z[i] := x[i] + y[i] for the eight threads of two warps; no
# branch and no mask change, so every lane is active in every cycle.
# Argument block at KERNEL_ARGS: n, x, y, z (byte addresses).
# Copyright (c) 2026 Sajid Muhaimin Choudhury. All rights reserved.
    .include "simt.inc"
    .text
    .globl _start
_start:
    li     t0, 2              # two warps
    lui    t1, %hi(kernel)
    addi   t1, t1, %lo(kernel)
    wspawn t0, t1             # warp 1 starts at kernel; warp 0 falls through
kernel:
    csrr   a0, KERNEL_ARGS
    lw     a1, 4(a0)          # x
    lw     a2, 8(a0)          # y
    lw     a3, 12(a0)         # z
    csrr   t0, THREAD_INDEX   # i
    slli   t0, t0, 2          # 4i, the byte offset of element i
    add    a1, a1, t0
    add    a2, a2, t0
    add    a3, a3, t0
    lw     t1, 0(a1)          # x[i]
    lw     t2, 0(a2)          # y[i]
    add    t1, t1, t2
    sw     t1, 0(a3)          # z[i] := x[i] + y[i]
    tmc    zero               # a zero mask ends the warp

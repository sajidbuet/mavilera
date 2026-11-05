# vadd_tail -- z[i] := x[i] + y[i] for i < n, with n read from the argument
# block. Each warp computes how many of its threads are in range and
# switches the rest off with tmc; a warp with none left ends there.
# Argument block at KERNEL_ARGS: n, x, y, z.
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
    lw     a4, 0(a0)          # n
    csrr   t0, THREAD_INDEX
    csrr   t1, LANE_ID
    sub    t1, t0, t1         # first thread of this warp
    sub    t1, a4, t1         # k := threads of this warp still below n
    bgez   t1, 1f             # uniform: k is the same in every lane
    li     t1, 0              # k := max(k, 0)
1:  li     t2, LANES
    ble    t1, t2, 2f
    mv     t1, t2             # k := min(k, LANES)
2:  li     t2, 1
    sll    t2, t2, t1
    addi   t2, t2, -1         # mask := 2^k - 1, the k lowest lanes
    tmc    t2                 # k = 0 ends the warp
    lw     a1, 4(a0)          # x
    lw     a2, 8(a0)          # y
    lw     a3, 12(a0)         # z
    slli   t0, t0, 2
    add    a1, a1, t0
    add    a2, a2, t0
    add    a3, a3, t0
    lw     t1, 0(a1)
    lw     t2, 0(a2)
    add    t1, t1, t2
    sw     t1, 0(a3)          # z[i] := x[i] + y[i], active threads only
    tmc    zero

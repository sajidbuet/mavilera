# reverse_bar -- y[i] := x[n-1-i] for i < n, in two phases separated by a
# barrier: phase 1 copies x[i] into the buffer s[i]; phase 2 reads s[n-1-i],
# which another warp may have written. A tail mask switches off the threads
# with i >= n, as in vadd_tail.
# Argument block at KERNEL_ARGS: n, x, s, y.
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
    sub    t1, t0, t1
    sub    t1, a4, t1         # k := threads of this warp below n
    bgez   t1, 1f
    li     t1, 0
1:  li     t2, LANES
    ble    t1, t2, 2f
    mv     t1, t2
2:  li     t2, 1
    sll    t2, t2, t1
    addi   t2, t2, -1
    tmc    t2                 # tail mask
    lw     a1, 4(a0)          # x
    lw     a2, 8(a0)          # s
    lw     a3, 12(a0)         # y
    slli   t1, t0, 2
    add    t2, a1, t1
    lw     t3, 0(t2)          # x[i]
    add    t2, a2, t1
    sw     t3, 0(t2)          # phase 1: s[i] := x[i]
    li     t4, 0              # barrier 0
    li     t5, 2              # wait for both warps
    bar    t4, t5
    sub    t1, a4, t0
    addi   t1, t1, -1         # j := n - 1 - i
    slli   t1, t1, 2
    add    t2, a2, t1
    lw     t3, 0(t2)          # s[j], written in phase 1, perhaps by the other warp
    slli   t1, t0, 2
    add    t2, a3, t1
    sw     t3, 0(t2)          # phase 2: y[i] := s[n-1-i]
    tmc    zero

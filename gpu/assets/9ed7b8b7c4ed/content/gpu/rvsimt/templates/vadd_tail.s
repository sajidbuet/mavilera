# vadd_tail.s -- RISC-V SIMT laboratory program: vector add with a tail: threads past n switched off.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (Apache-2.0); provenance of vadd_tail/prog.s and data.hex: test/fixtures/gpu/lab/README.md.
# Written by tools/gpu/lab-templates.mjs; do not edit by hand.
#
# z = x + y for n = 6 elements on eight threads: the last threads of warp 1 are masked off.
# Profile: two warps of four lanes. The data section is the data memory from
# address 0: the argument block (kernel_args = 0) and the arrays.
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

        .data                   # the data memory, from address 0 (data.hex)
        .word 0x00000006, 0x00000100, 0x00000140, 0x00000180, 0x00000000, 0x00000000, 0x00000000, 0x00000000   # 0x000
        .space 224
        .word 0x00000001, 0x00000002, 0x00000003, 0x00000004, 0x00000005, 0x00000006, 0x00000007, 0x00000008   # 0x100
        .space 32
        .word 0x00000064, 0x000000c8, 0x0000012c, 0x00000190, 0x000001f4, 0x00000258, 0x000002bc, 0x00000320   # 0x140
        .space 32
        .word 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff   # 0x180

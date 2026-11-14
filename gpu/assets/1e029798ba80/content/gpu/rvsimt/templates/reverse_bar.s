# reverse_bar.s -- RISC-V SIMT laboratory program: reverse an array through a barrier.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (Apache-2.0); provenance of reverse_bar/prog.s and data.hex: test/fixtures/gpu/lab/README.md.
# Written by tools/gpu/lab-templates.mjs; do not edit by hand.
#
# Each thread writes one element, every warp waits at bar, then each reads its partner's element.
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

        .data                   # the data memory, from address 0 (data.hex)
        .word 0x00000006, 0x00000100, 0x00000140, 0x00000180, 0x00000000, 0x00000000, 0x00000000, 0x00000000   # 0x000
        .space 224
        .word 0x0000000b, 0x00000016, 0x00000021, 0x0000002c, 0x00000037, 0x00000042, 0x0000004d, 0x00000058   # 0x100
        .space 32
        .word 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff   # 0x140
        .space 32
        .word 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff   # 0x180

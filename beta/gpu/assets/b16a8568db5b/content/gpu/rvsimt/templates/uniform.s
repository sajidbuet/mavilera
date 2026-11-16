# uniform.s -- RISC-V SIMT laboratory program: no divergence: every thread takes the same path.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (Apache-2.0); provenance of uniform/prog.s and data.hex: test/fixtures/gpu/lab/README.md.
# Written by tools/gpu/lab-templates.mjs; do not edit by hand.
#
# Two warps of four threads; branches whose outcome every thread of the warp shares.
# Profile: two warps of four lanes. The data section is the data memory from
# address 0: the argument block (kernel_args = 0) and the arrays.
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

        .data                   # the data memory, from address 0 (data.hex)
        .word 0x00000008, 0x00000100, 0x00000140, 0x00000180, 0x00000000, 0x00000000, 0x00000000, 0x00000000   # 0x000
        .space 224
        .word 0x00000003, 0xffffffff, 0x00000004, 0x00000001, 0xfffffffb, 0x00000009, 0x00000002, 0xfffffffa   # 0x100
        .space 32
        .word 0x0000000a, 0x00000014, 0x0000001e, 0x00000028, 0x00000032, 0x0000003c, 0x00000046, 0x00000050   # 0x140
        .space 32
        .word 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff   # 0x180

# nested.s -- RISC-V SIMT laboratory program: nested divergence: a split inside a split.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (Apache-2.0); provenance of nested/prog.s and data.hex: test/fixtures/gpu/lab/README.md.
# Written by tools/gpu/lab-templates.mjs; do not edit by hand.
#
# Two nested splits fill the reconvergence stack (four entries per warp).
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

        .data                   # the data memory, from address 0 (data.hex)
        .word 0x00000008, 0x00000100, 0x00000140, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000   # 0x000
        .space 224
        .word 0x00000004, 0xffffffff, 0xfffffffa, 0x00000003, 0x00000000, 0xfffffffa, 0xfffffff9, 0x00000005   # 0x100
        .space 32
        .word 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff   # 0x140

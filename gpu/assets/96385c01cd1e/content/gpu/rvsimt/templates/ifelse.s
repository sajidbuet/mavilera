# ifelse.s -- RISC-V SIMT laboratory program: an if/else with split and join.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (Apache-2.0); provenance of ifelse/prog.s and data.hex: test/fixtures/gpu/lab/README.md.
# Written by tools/gpu/lab-templates.mjs; do not edit by hand.
#
# y = 3x for x >= 0, else x / 2 rounded towards zero: the then-path runs first under split, join reconverges.
# Profile: two warps of four lanes. The data section is the data memory from
# address 0: the argument block (kernel_args = 0) and the arrays.
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

        .data                   # the data memory, from address 0 (data.hex)
        .word 0x00000008, 0x00000100, 0x00000140, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000   # 0x000
        .space 224
        .word 0x00000004, 0xffffffff, 0xfffffffa, 0x00000003, 0x00000000, 0xfffffffe, 0x00000007, 0x00000005   # 0x100
        .space 32
        .word 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff   # 0x140

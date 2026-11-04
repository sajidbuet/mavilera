# sw-mv-m.s -- laboratory program, comparison only: the software baseline with mul.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (Apache-2.0); provenance of sw_mv_m/prog.s and data set v4 (commit 9e99307):
# test/fixtures/npu/README.md. Written by tools/npu/lab-templates.mjs; do not edit by hand.
#
# The laboratory core has no M extension, so this runs on the instruction level only: the profile
# "Laboratory SoC with the NPU", one cycle per instruction (818 cycles for these four vectors).
# Data: four vectors from 0x040 (NV at 0x000, W at 0x010). The Analysis view also runs the sets of 1 and 16
# vectors; or load a data file of 128 words into the array ram (Data menu), then assemble again.
        .text
        .equ GPIO,  0x40000000
        .equ NV,    0x000
        .equ WBASE, 0x010
        .equ XBASE, 0x040
        .equ YBASE, 0x100

        li   s0, GPIO
        li   t0, 1
        sw   t0, 0(s0)          # marker 1: start
        lw   s1, NV(zero)
        li   s2, XBASE
        li   s3, YBASE
vec:    beq  s1, zero, done
        lw   s4, 0(s2)
        li   s5, WBASE
        li   s6, 4
row:    lw   s7, 0(s5)
        mv   s9, s4
        li   s8, 0
        li   s10, 4
elem:   slli a0, s7, 24
        srai a0, a0, 24         # W[i][j]
        slli a1, s9, 24
        srai a1, a1, 24         # x[j]
        mul  a2, a0, a1         # the product in one instruction
        add  s8, s8, a2
        srli s7, s7, 8
        srli s9, s9, 8
        addi s10, s10, -1
        bne  s10, zero, elem
        sw   s8, 0(s3)
        addi s3, s3, 4
        addi s5, s5, 4
        addi s6, s6, -1
        bne  s6, zero, row
        addi s2, s2, 4
        addi s1, s1, -1
        j    vec
done:   li   t0, 2
        sw   t0, 0(s0)          # marker 2: end
        halt

        .data                   # RAM words 0-127: the data set v4 (data.hex)
ram:
        .word 0x00000004, 0x00000000, 0x00000000, 0x00000000, 0xf2b42380, 0xfa617b57, 0x13b8a981, 0x7f8566b2
        .word 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
        .word 0x007f8020, 0xa7403632, 0x1315ad2e, 0x8c1ec86a, 0x00000000, 0x00000000, 0x00000000, 0x00000000
        .word 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
        .word 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
        .word 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
        .word 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
        .word 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
        .word 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
        .word 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
        .word 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
        .word 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
        .word 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
        .word 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
        .word 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
        .word 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000

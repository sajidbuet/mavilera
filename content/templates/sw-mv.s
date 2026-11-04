# sw-mv.s -- laboratory program, software baseline: y = W x on the RV32I core alone (shift-and-add products).
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (Apache-2.0); provenance of sw_mv/prog.s and data set v4 (commit 9e99307):
# test/fixtures/npu/README.md. Written by tools/npu/lab-templates.mjs; do not edit by hand.
#
# Opens in the single-cycle view with the platform devices on and 1024 words of memory, as the laboratory SoC.
# Run to the halt: the counters panel gives the cycles from marker 1 to marker 2 (3718 for these four vectors).
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
        lw   s1, NV(zero)       # vectors left
        li   s2, XBASE          # vector pointer
        li   s3, YBASE          # result pointer
vec:    beq  s1, zero, done
        lw   s4, 0(s2)          # x, packed
        li   s5, WBASE          # row pointer
        li   s6, 4              # rows left
row:    lw   s7, 0(s5)          # W row, packed
        mv   s9, s4             # x, consumed byte by byte
        li   s8, 0              # accumulator y[i]
        li   s10, 4             # elements left
elem:   slli a0, s7, 24
        srai a0, a0, 24         # a0 = W[i][j], sign-extended
        slli a1, s9, 24
        srai a1, a1, 24         # a1 = x[j], sign-extended
        li   a2, 0              # a2 = a0 * a1 by shift-and-add
        andi t1, a1, 255        # multiplier bits (x[j] mod 256)
        mv   t2, a0             # multiplicand, shifted left each step
mloop:  beq  t1, zero, mfix
        andi t3, t1, 1
        beq  t3, zero, mskip
        add  a2, a2, t2
mskip:  slli t2, t2, 1
        srli t1, t1, 1
        j    mloop
mfix:   bge  a1, zero, mdone    # x[j] < 0: x[j] = (x[j] mod 256) - 256
        slli t3, a0, 8
        sub  a2, a2, t3
mdone:  add  s8, s8, a2
        srli s7, s7, 8          # next weight
        srli s9, s9, 8          # next element of x
        addi s10, s10, -1
        bne  s10, zero, elem
        sw   s8, 0(s3)          # y[i]
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

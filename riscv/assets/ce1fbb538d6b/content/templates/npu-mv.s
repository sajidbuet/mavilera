# npu-mv.s -- laboratory program, accelerated version: y = W x on the NPU, polled.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (Apache-2.0); provenance of npu_mv/prog.s and data set v4 (commit c2dc4c4):
# test/fixtures/npu/README.md. Written by tools/npu/lab-templates.mjs; do not edit by hand.
#
# Opens in the single-cycle view with the platform devices on and 1024 words of memory, as the laboratory SoC.
# The NPU sits at 0x5000_0000. The counters panel gives the cycles between the markers (for these four vectors:
# 10 from 1 to 2, 143 from 2 to 3: 153 in all), the NPU accesses and the STATUS reads; the NPU view shows the
# NPU's registers, and the Analysis view where the cycles go.
# Data: four vectors from 0x040 (NV at 0x000, W at 0x010). The Analysis view also runs the sets of 1 and 16
# vectors; or load a data file of 128 words into the array ram (Data menu), then assemble again.
        .text
        .equ GPIO,   0x40000000
        .equ NPU,    0x50000000
        .equ CTRL,   0x00
        .equ STATUS, 0x04
        .equ WEIGHT, 0x10
        .equ ACT,    0x20
        .equ RESULT, 0x30
        .equ NV,     0x000
        .equ WBASE,  0x010
        .equ XBASE,  0x040
        .equ YBASE,  0x100

        li   s0, GPIO
        li   s1, NPU
        li   t0, 1
        sw   t0, 0(s0)          # marker 1: start
        lw   t0, WBASE+0(zero)  # weights: four words, once
        sw   t0, WEIGHT+0(s1)
        lw   t0, WBASE+4(zero)
        sw   t0, WEIGHT+4(s1)
        lw   t0, WBASE+8(zero)
        sw   t0, WEIGHT+8(s1)
        lw   t0, WBASE+12(zero)
        sw   t0, WEIGHT+12(s1)
        li   t0, 2
        sw   t0, 0(s0)          # marker 2: weights loaded
        lw   s2, NV(zero)       # vectors left
        li   s3, XBASE          # vector pointer
        li   s4, YBASE          # result pointer
        li   s5, 3              # CTRL value: clear and start
vec:    beq  s2, zero, done
        lw   t0, 0(s3)          # x, packed
        sw   t0, ACT+0(s1)      # x[0]
        srli t1, t0, 8
        sw   t1, ACT+4(s1)      # x[1]
        srli t1, t0, 16
        sw   t1, ACT+8(s1)      # x[2]
        srli t1, t0, 24
        sw   t1, ACT+12(s1)     # x[3]
        sw   s5, CTRL(s1)       # clear the accumulators and start
poll:   lw   t1, STATUS(s1)
        andi t1, t1, 2          # done?
        beq  t1, zero, poll
        lw   t1, RESULT+0(s1)   # copy y[0..3] to RAM
        sw   t1, 0(s4)
        lw   t1, RESULT+4(s1)
        sw   t1, 4(s4)
        lw   t1, RESULT+8(s1)
        sw   t1, 8(s4)
        lw   t1, RESULT+12(s1)
        sw   t1, 12(s4)
        addi s4, s4, 16
        addi s3, s3, 4
        addi s2, s2, -1
        j    vec
done:   li   t0, 3
        sw   t0, 0(s0)          # marker 3: end
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

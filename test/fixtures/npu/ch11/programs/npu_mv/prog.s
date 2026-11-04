# npu_mv/prog.s -- Chapter 11 laboratory, accelerated version: y = W x for
# NV vectors on the NPU in the accelerator slot 0x5000_0000.
# Data as in sw_mv/prog.s. The weights are copied into the NPU once; each
# vector is written to ACT[0..3] (the NPU takes bits 7..0 of each word, so a
# shift is enough to unpack x), the NPU is cleared and started with one
# store, STATUS is polled until done, and RESULT[0..3] are copied to RAM.
# Markers: GPIO OUT = 1 at the start, 2 when the weights are loaded, 3 at
# the end.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. All rights reserved.
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

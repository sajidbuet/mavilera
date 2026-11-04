# sw_mv_m/prog.s -- Chapter 11 laboratory, comparison only: the software
# baseline of sw_mv/prog.s with the shift-and-add multiplication replaced by
# the M-extension instruction mul. The laboratory core has no M extension, so
# this program runs only in the book's simulator (code/sim/rvsim.py), with
# one cycle per instruction as stated in the chapter. Data and markers as in
# sw_mv/prog.s.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. All rights reserved.
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

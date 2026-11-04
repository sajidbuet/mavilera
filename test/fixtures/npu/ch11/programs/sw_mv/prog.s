# sw_mv/prog.s -- Chapter 11 laboratory, software baseline: y = W x for
# NV vectors on the RV32I core alone. The core has no M extension, so each
# INT8 x INT8 product is formed by shift-and-add.
# Data (preloaded in RAM): NV at 0x000; W at 0x010 (row i in word i, four
# INT8, W[i][j] in bits 8j+7..8j); vector v at 0x040 + 4v (four INT8);
# results y[i] of vector v to 0x100 + 16v + 4i (INT32).
# Markers: GPIO OUT = 1 when the measured region starts, 2 when it ends.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. All rights reserved.
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

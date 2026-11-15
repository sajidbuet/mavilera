# tests-divcases.s -- Division by zero and signed overflow in the M extension.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        .text
_start: li    t0, 1234567        # dividend x
        li    t1, 0x80000000     # most-negative integer
        li    t2, -1
        divu  s0, t0, zero       # 2^32 - 1
        remu  s1, t0, zero       # x
        div   s2, t0, zero       # -1
        rem   s3, t0, zero       # x
        div   s4, t1, t2         # -2^31 (overflow)
        rem   s5, t1, t2         # 0
        li    t3, -7
        li    t4, 2
        div   s6, t3, t4         # -3 (towards zero)
        rem   s7, t3, t4         # -1 (sign of the dividend)
        mulh  s8, t1, t1         # (-2^31)^2 >> 32 = 0x40000000
        mulhu s9, t2, t2         # (2^32-1)^2 >> 32 = 0xFFFFFFFE
        mulhsu s10, t2, t2       # -1 * (2^32-1) >> 32 = 0xFFFFFFFF
        mul   s11, t2, t2        # low word 1
        ebreak

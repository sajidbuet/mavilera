# tests-bytes.s -- Byte and half-word loads and stores, sign and zero extension, little-endian layout, and a string length.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        .data
w:      .word 0x80F17F02
buf:    .space 8
str:    .asciz "RISC-V\n"
        .text
_start: la    s0, w
        lb    s1, 3(s0)          # 0x80 sign-extended
        lbu   s2, 3(s0)          # 0x80 zero-extended
        lh    s3, 2(s0)          # 0x80F1 sign-extended
        lhu   s4, 2(s0)          # 0x80F1 zero-extended
        lb    s5, 1(s0)          # 0x7F
        la    t0, buf
        li    t1, -2
        sh    t1, 2(t0)          # bytes FE FF at buf+2
        sb    t1, 5(t0)          # byte FE at buf+5
        lw    s6, 0(t0)          # 0xFFFE0000
        lw    s7, 4(t0)          # 0x0000FE00
        la    t0, str            # strlen
        li    a0, 0
len:    add   t2, t0, a0
        lbu   t3, 0(t2)
        beqz  t3, done
        addi  a0, a0, 1
        j     len
done:   ebreak

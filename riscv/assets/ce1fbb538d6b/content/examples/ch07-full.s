# ch07-full.s -- Every instruction of the processor, with jalr, lui, auipc and all six branches.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        auipc t0, 0             # t0 = 0x000 (address of this instruction)
        auipc t1, 1             # t1 = 0x004 + 0x1000
        lui   t2, 0xFFFFF       # 0xFFFFF000
        addi  t2, t2, 0x7FF     # 0xFFFFF7FF
        addi  s0, zero, -1
        addi  s1, zero, 1
        blt   s0, s1, L1        # signed -1 < 1: taken
        addi  t6, zero, 1       # (skipped)
L1:     bltu  s0, s1, bad       # unsigned 0xFFFFFFFF < 1: not taken
        bge   s1, s0, L2        # signed 1 >= -1: taken
        addi  t6, zero, 2       # (skipped)
L2:     bgeu  s0, s1, L3        # unsigned 0xFFFFFFFF >= 1: taken
        jal   zero, bad
L3:     slli  a0, s1, 31        # 0x80000000
        srai  a1, a0, 4         # 0xF8000000
        srli  a2, a0, 4         # 0x08000000
        sltiu a3, s0, 5         # 0: 0xFFFFFFFF < 5 is false
        sltiu a4, s1, -1        # 1: 1 < 0xFFFFFFFF
        xori  a5, s0, 0x555     # 0xFFFFFAAA
        addi  s2, zero, 0       # accumulator for the subroutine
        addi  s3, zero, 5       # count
        addi  s4, zero, 512     # data base address
        jal   ra, sum           # call: ra = return address
        sw    s2, 0(s4)         # 5 + 4 + 3 + 2 + 1 = 15
        auipc s5, 0
        jalr  s6, 12(s5)        # jump over one instruction; s6 = link
        addi  t6, zero, 3       # (skipped)
        sw    s6, 4(s4)
        sub   s7, zero, s3      # s3 = 0 after the subroutine
        sra   s8, a1, s1        # 0xFC000000
        sltu  s9, s1, s0        # 1: 1 < 0xFFFFFFFF
        slt   s10, s0, s1       # 1: -1 < 1
        sll   s11, s1, s1       # 2
        srl   t3, s0, s1        # 0x7FFFFFFF
        xor   t4, s0, s1        # 0xFFFFFFFE
        lw    t5, 0(s4)         # 15
        halt
sum:    add   s2, s2, s3
        addi  s3, s3, -1
        bne   s3, zero, sum
        jalr  zero, 1(ra)       # return: target ra + 1 with bit 0 cleared
bad:    addi  t6, zero, -1      # reached only if a branch is wrong
        halt

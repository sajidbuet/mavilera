# ch06-full.s -- Every instruction of the processor, with the further branches, jalr and auipc.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        auipc x1, 0             # x1 = 0x000 (address of this instruction)
        auipc x2, 1             # x2 = 0x004 + 0x1000
        lui   x3, 0xFFFFF       # 0xFFFFF000
        addi  x3, x3, 0x7FF     # 0xFFFFF7FF
        addi  x4, x0, -1
        addi  x5, x0, 1
        blt   x4, x5, L1        # signed -1 < 1: taken
        addi  x31, x0, 1        # (skipped)
L1:     bltu  x4, x5, bad       # unsigned 0xFFFFFFFF < 1: not taken
        bge   x5, x4, L2        # signed 1 >= -1: taken
        addi  x31, x0, 2        # (skipped)
L2:     bgeu  x4, x5, L3        # unsigned 0xFFFFFFFF >= 1: taken
        jal   x0, bad
L3:     slli  x6, x5, 31        # 0x80000000
        srai  x7, x6, 4         # 0xF8000000
        srli  x8, x6, 4         # 0x08000000
        sltiu x9, x4, 5         # 0: 0xFFFFFFFF < 5 is false
        sltiu x10, x5, -1       # 1: 1 < 0xFFFFFFFF
        xori  x11, x4, 0x555    # 0xFFFFFAAA
        addi  x12, x0, 0        # accumulator for the subroutine
        addi  x13, x0, 5        # count
        jal   ra, sum           # call: ra = return address
        sw    x12, 0(x0)        # 5 + 4 + 3 + 2 + 1 = 15
        auipc x14, 0
        jalr  x15, 12(x14)      # jump over one instruction; x15 = link
        addi  x31, x0, 3        # (skipped)
        sw    x15, 4(x0)
        sub   x16, x0, x13      # x13 = 0 after the subroutine
        sra   x17, x7, x5       # 0xFC000000
        halt
sum:    add   x12, x12, x13
        addi  x13, x13, -1
        bne   x13, x0, sum
        jalr  x0, 1(ra)         # return: target ra + 1 with bit 0 cleared
bad:    addi  x31, x0, -1       # reached only if a branch is wrong
        halt

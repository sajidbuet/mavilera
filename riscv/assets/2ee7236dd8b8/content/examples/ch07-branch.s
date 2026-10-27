# ch07-branch.s -- R-type, immediate ALU, lw, sw, beq, bne, lui and jal.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        lui  s4, 0x12345        # s4 = 0x12345000
        addi t0, zero, 0        # running sum
        addi t1, zero, 1        # i
        addi t2, zero, 11       # loop limit
loop:   add  t0, t0, t1
        addi t1, t1, 1
        bne  t1, t2, loop       # taken nine times, falls through once
        addi a0, zero, 512
        sw   t0, 0(a0)          # 55
        beq  t0, zero, fail     # not taken
        jal  a5, skip           # a5 = address of the next instruction
        addi a6, zero, 99       # skipped by the jump
skip:   addi a7, zero, 1
        beq  a7, a7, done       # always taken
fail:   addi s2, zero, -1       # never executed
done:   or   s3, s4, t0         # 0x12345037
        lw   s5, 0(a0)
        andi s6, s5, 0x0F
        ori  s7, s6, 0x100
        slti s8, s7, 0x200
        halt

# ch06-branch.s -- R-type, immediate ALU, lw, sw, beq, bne, lui and jal.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        lui  x20, 0x12345       # x20 = 0x12345000
        addi x1, x0, 0          # running sum
        addi x2, x0, 1          # i
        addi x3, x0, 11         # loop limit
loop:   add  x1, x1, x2
        addi x2, x2, 1
        bne  x2, x3, loop       # taken nine times, falls through once
        addi x10, x0, 64
        sw   x1, 0(x10)         # 55
        beq  x1, x0, fail       # not taken
        jal  x5, skip           # x5 = address of the next instruction
        addi x6, x0, 99         # skipped by the jump
skip:   addi x7, x0, 1
        beq  x7, x7, done       # always taken
fail:   addi x8, x0, -1         # never executed
done:   or   x9, x20, x1        # 0x12345037
        lw   x12, 0(x10)
        andi x13, x12, 0x0F
        ori  x14, x13, 0x100
        slti x15, x14, 0x200
        halt

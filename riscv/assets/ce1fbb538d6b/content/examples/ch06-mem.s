# ch06-mem.s -- lw and sw with positive and negative offsets.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        addi x10, x0, 64        # base address of a small array (word 16)
        addi x1, x0, 11
        sw   x1, 0(x10)
        addi x1, x0, -3
        sw   x1, 4(x10)
        addi x1, x0, 100
        sw   x1, 8(x10)
        lw   x2, 0(x10)
        lw   x3, 4(x10)
        lw   x4, 8(x10)
        add  x5, x2, x3
        add  x5, x5, x4         # 11 - 3 + 100 = 108
        sw   x5, 12(x10)
        lw   x6, -4(x10)        # word 15 was never written: 0
        sw   x5, -4(x10)
        lw   x7, -4(x10)        # read back what was just stored
        addi x11, x10, 4
        lw   x8, 8(x11)         # same word as 12(x10)
        halt

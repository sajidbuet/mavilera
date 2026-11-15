# ch07-mem.s -- lw and sw with positive and negative offsets.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        addi a0, zero, 512      # base address of a small array (word 128)
        addi t0, zero, 11
        sw   t0, 0(a0)
        addi t0, zero, -3
        sw   t0, 4(a0)
        addi t0, zero, 100
        sw   t0, 8(a0)
        lw   t1, 0(a0)
        lw   t2, 4(a0)
        lw   s0, 8(a0)
        add  s1, t1, t2
        add  s1, s1, s0         # 11 - 3 + 100 = 108
        sw   s1, 12(a0)
        lw   a1, -4(a0)         # word 127 was never written: 0
        sw   s1, -4(a0)
        lw   a2, -4(a0)         # read back what was just stored
        addi a3, a0, 4
        lw   a4, 8(a3)          # same word as 12(a0)
        halt

# ch07-lw-steps.s -- One load, lw x5, 8(x6), step by step.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        addi x6, x0, 512        # 0x000: x6 = 0x200
        addi x7, x0, 42         # 0x004
        sw   x7, 8(x6)          # 0x008: M[0x208] = 42
        lw   x5, 8(x6)          # 0x00C: the traced load
        halt                    # 0x010

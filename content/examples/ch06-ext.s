# ch06-ext.s -- xori and lbu (the lbu extension of the processor).
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        addi x5, x0, -93        # 0xFFFFFFA3
        xori x6, x5, 0x7F0      # immediate bit 10 is instruction bit 30
        sw   x6, 16(x0)
        lbu  x7, 17(x0)         # byte 1 of the word just stored
        lw   x8, 16(x0)         # the whole word, unchanged by the extension
        xori x9, x7, -1         # xori with -1 inverts every bit
        halt

# ch06-lwwave.s -- Store a word, then load it back with a negative offset.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        lui  x7, 0x12345
        addi x7, x7, 0x678      # x7 = 0x12345678
        addi x6, x0, 72         # x6 = 0x48
        sw   x7, -8(x6)         # word at 0x40
        lw   x5, -8(x6)         # x5 = 0x12345678
        halt

# ch08-loaduse.s -- Load-use chains: stalls.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        addi x10, x0, 64        # base address of a small array
        addi x1, x0, 7
        sw   x1, 0(x10)
        addi x1, x0, 20
        sw   x1, 4(x10)
        addi x1, x0, -3
        sw   x1, 8(x10)
        sw   x10, 16(x10)       # a pointer: word 0x50 holds 0x40
        lw   x2, 0(x10)
        add  x3, x2, x2         # load-use: one bubble, x3 = 14
        lw   x4, 4(x10)
        addi x5, x0, 1          # independent: no bubble
        add  x6, x4, x5         # x4 two instructions back, from WB: x6 = 21
        lw   x7, 8(x10)
        sw   x7, 12(x10)        # store of the loaded value: one bubble here
        lw   x0, 0(x10)         # destination x0: no bubble
        add  x8, x0, x0
        lw   x11, 16(x10)       # x11 = 0x40
        lw   x12, 4(x11)        # base address from a load: one bubble, x12 = 20
        add  x13, x12, x3       # load-use again: x13 = 34
        sw   x13, 20(x10)
        halt

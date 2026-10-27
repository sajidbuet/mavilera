# ch08-dep.s -- Dependent arithmetic: forwarding from MEM and WB.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        addi x1, x0, 5          # x1 = 5
        addi x2, x1, 3          # rs1 at distance 1: x2 = 8
        add  x3, x1, x2         # rs1 at distance 2, rs2 at distance 1: x3 = 13
        sub  x4, x3, x1         # rs1 at distance 1, rs2 at distance 3: x4 = 8
        addi x0, x4, 1          # writes x0: must never be forwarded
        add  x5, x0, x4         # x5 = 8
        addi x6, x0, 1
        addi x6, x6, 1          # x6 = 2
        addi x6, x6, 1          # x6 written in MEM and in WB: the newer wins, x6 = 3
        add  x7, x6, x6         # both operands from MEM: x7 = 6
        lui  x8, 0x12345        # x8 = 0x12345000
        addi x8, x8, 0x678      # x8 = 0x12345678
        auipc x9, 0             # x9 = 0x30, the address of this instruction
        addi x9, x9, 4          # x9 = 0x34
        addi x11, x0, 64        # base address of the results
        sw   x8, 0(x11)         # base forwarded from MEM
        addi x12, x0, -7
        sw   x12, 4(x11)        # store data forwarded from MEM
        xor  x13, x8, x7        # 0x1234567e
        srl  x14, x13, x6       # 0x02468acf
        sw   x14, 8(x11)
        halt

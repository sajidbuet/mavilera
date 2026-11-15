# ch06-rtype.s -- Register-register and register-immediate ALU instructions.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        addi x1, x0, 25         # x1 = 25
        addi x2, x0, -7         # x2 = -7
        add  x3, x1, x2         # 18
        sub  x4, x1, x2         # 32
        and  x5, x1, x2
        or   x6, x1, x2
        xor  x7, x1, x2
        slt  x8, x2, x1         # signed: -7 < 25
        sltu x9, x2, x1         # unsigned: 0xFFFFFFF9 < 25 is false
        addi x10, x0, 3
        sll  x11, x1, x10       # 25 << 3
        srl  x12, x2, x10       # logical shift of a negative number
        sra  x13, x2, x10       # arithmetic shift keeps the sign
        andi x14, x2, 0x0F0
        ori  x15, x1, -256
        slti x16, x2, -6
        slti x17, x1, 25
        add  x0, x1, x1         # a write to x0 is discarded
        add  x18, x0, x3        # copies x3
        halt

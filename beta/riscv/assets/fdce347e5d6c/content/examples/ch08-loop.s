# ch08-loop.s -- A loop with a backward branch, a call and a return.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        addi x1, x0, 0          # sum
        addi x2, x0, 10         # counter
loop:   add  x1, x1, x2
        addi x2, x2, -1
        bne  x2, x0, loop       # taken nine times, not taken once
        addi x10, x0, 64
        sw   x1, 0(x10)         # 55
        jal  x5, double         # call
        sw   x6, 4(x10)         # 110
        halt
double: add  x6, x1, x1         # x6 = 2 * sum
        jalr x0, 0(x5)          # return

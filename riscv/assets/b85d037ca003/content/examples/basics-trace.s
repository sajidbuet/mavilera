# basics-trace.s -- A 12-instruction program to trace by hand and check with the simulator's trace.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        la    s0, hi            # s0 = address of hi
        lhu   t0, 0(s0)         # t0 = upper half
        lhu   t1, 2(s0)         # t1 = lower half
        slli  t0, t0, 16        # move it to bits 31:16
        or    t2, t0, t1        # t2 = joined word
        srli  t3, t2, 24        # t3 = its top byte
        sw    t2, 4(s0)         # store it at out
        lbu   a0, 5(s0)         # byte 1 of out
        addi  a0, a0, 1         # exit code
        li    a7, 93
        ecall
        .data
hi:     .half 0xBEEF, 0x1234
out:    .word 0

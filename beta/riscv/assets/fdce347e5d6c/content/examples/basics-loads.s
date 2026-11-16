# basics-loads.s -- Five loads of different widths from the same eight bytes.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        la    s0, block         # s0 = 0x00010000
        lb    t0, 0(s0)         # byte 0x84, sign-extended
        lbu   t1, 0(s0)         # byte 0x84, zero-extended
        lh    t2, 2(s0)         # half-word at +2, sign-extended
        lhu   t3, 2(s0)         # the same half-word, zero-extended
        lw    t4, 4(s0)         # word at +4
        li    a0, 0
        li    a7, 93
        ecall
        .data
block:  .byte 0x84, 0x23, 0xF0, 0x9A, 0x78, 0x56, 0x34, 0x12

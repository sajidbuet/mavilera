# gpio-regs.s -- the GPIO registers: OUT, OUT_SET, OUT_CLR, OUT_TGL, DIR, a read of IN, and the timer's write paths.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: code (a test program for test/priv-conformance.test.mjs).
        .text
start:  li    s0, 0x40000000
        li    t0, 0xa5
        sw    t0, 0(s0)          # OUT
        li    t0, 0x0f
        sw    t0, 0xc(s0)        # OUT_SET
        li    t0, 0x81
        sw    t0, 0x10(s0)       # OUT_CLR
        li    t0, 0xff
        sw    t0, 0x14(s0)       # OUT_TGL
        sw    t0, 8(s0)          # DIR
        lw    a0, 0(s0)
        lw    a1, 4(s0)          # IN (no events: 0)
        lw    a2, 8(s0)
        lw    a3, 0x18(s0)
        lw    a4, 0x1c(s0)
        lw    a5, 0x20(s0)       # no register: reads 0
        li    s1, 0x40001000
        li    t0, 1000
        sw    t0, 0(s1)          # MTIME := 1000
        lw    a6, 0(s1)
        lw    a7, 4(s1)
        li    t0, 7
        sw    t0, 4(s1)          # MTIMEH := 7
        lw    s2, 4(s1)
        sw    zero, 0x20(s1)     # no register: ignored
        li    s3, 0x40ff0000
        lw    s4, 0(s3)          # elsewhere in the window: 0
        sw    t0, 0(s3)          # ignored
        lw    s5, 0(s3)
        halt

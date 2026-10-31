# timer-vectored.s -- the machine timer with a vectored mtvec: three ticks, each re-arming MTIMECMP; then halt.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: code (a test program for test/priv-conformance.test.mjs).
        .text
start:  la    t0, vec
        ori   t0, t0, 1          # MODE = vectored
        csrw  mtvec, t0
        li    s0, 0x40001000
        lw    t1, 0(s0)          # MTIME
        addi  t1, t1, 50
        sw    t1, 8(s0)          # MTIMECMP
        sw    zero, 12(s0)
        li    t1, 0x80
        csrs  mie, t1            # MTIE
        csrsi mstatus, 8
        li    s1, 0
spin:   addi  s2, s2, 1
        li    t2, 3
        blt   s1, t2, spin
        halt
        .align 2
vec:    j     bad                # 0
        j     bad                # 1
        j     bad                # 2
        j     bad                # 3
        j     bad                # 4
        j     bad                # 5
        j     bad                # 6
        j     tick               # 7: machine timer
        j     bad                # 8
        j     bad                # 9
        j     bad                # 10
        j     bad                # 11
tick:   addi  s1, s1, 1
        lw    t3, 0(s0)
        addi  t3, t3, 50
        sw    t3, 8(s0)          # re-arm
        mret
bad:    li    s11, -1
        halt

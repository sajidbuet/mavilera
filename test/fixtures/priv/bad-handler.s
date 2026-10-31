# bad-handler.s -- a timer interrupt handler that does not give back a register, and once returns to the wrong place.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: code (a test program for test/priv-conformance.test.mjs, the trap check).
        .text
start:  la    t0, handler
        csrw  mtvec, t0
        li    s0, 0x40001000
        li    s5, 77             # a value the handler must leave alone
        li    s1, 0
        lw    t1, 0(s0)
        addi  t1, t1, 30
        sw    t1, 8(s0)
        sw    zero, 12(s0)
        li    t1, 0x80
        csrs  mie, t1
        csrsi mstatus, 8
spin:   addi  s2, s2, 1
        li    t2, 3
        blt   s1, t2, spin
        halt
handler:
        addi  s1, s1, 1
        addi  s5, s5, 1          # not saved: s5 changes
        lw    t3, 0(s0)
        addi  t3, t3, 30
        sw    t3, 8(s0)
        li    t4, 2
        bne   s1, t4, back
        csrr  t5, mepc
        addi  t5, t5, 4          # the second time: skip an instruction
        csrw  mepc, t5
back:   mret

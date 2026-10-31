# button-irq.s -- the button interrupt: IRQ_EN, mie.MEIE, mstatus.MIE, wfi, and the handler that acknowledges.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: code (a test program for test/priv-conformance.test.mjs; stimulus: button-irq.irq).
        .text
start:  la    t0, handler
        csrw  mtvec, t0
        li    t0, 0x40000000
        li    t1, 0x100
        sw    t1, 0x18(t0)       # IRQ_EN: the button
        li    t1, 0x800
        csrs  mie, t1            # MEIE
        csrsi mstatus, 8         # MIE
        li    s1, 0
wait:   wfi
        li    t2, 3
        blt   s1, t2, wait
        csrr  s2, mcycle
        sw    s1, 0xc(t0)        # OUT_SET
        sw    s1, 0x14(t0)       # OUT_TGL
        halt
handler:
        li    s3, 0x40000000
        li    s4, 0x100
        sw    s4, 0x1c(s3)       # acknowledge: write 1 to IRQ_PEND
        addi  s1, s1, 1
        sw    s1, 0(s3)          # the count on the LEDs
        mret

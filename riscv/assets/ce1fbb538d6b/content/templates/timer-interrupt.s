# timer-interrupt.s -- a periodic timer interrupt: the handler flips LED 0 and sets the next time.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a template written for the application).
#
# The timer interrupt is requested while MTIME >= MTIMECMP. The handler writes a later value to
# MTIMECMP, which both removes the request and schedules the next one: forget that and the interrupt
# comes straight back. The main program sleeps in wfi between ticks and stops after five.
# Step into the handler and watch mcause (0x80000007), mepc and the lamp on the interrupt line in the
# Peripherals tab. The cycles are those of the abstract processor (1 per instruction, 3 to take a trap).
        .text
main:   la    t0, handler
        csrw  mtvec, t0
        li    s0, 0x40001000    # the timer
        li    s3, 0x40000000    # the GPIO
        li    s1, 0             # ticks counted
        lw    t0, 0(s0)         # MTIME
        addi  t0, t0, 100
        sw    t0, 8(s0)         # MTIMECMP: the first tick, 100 cycles from now
        sw    zero, 12(s0)      # its high word
        li    t0, 0x80
        csrs  mie, t0           # mie.MTIE: the timer may interrupt
        csrsi mstatus, 8        # mstatus.MIE
idle:   wfi
        li    t1, 5
        blt   s1, t1, idle
        csrci mstatus, 8        # interrupts off again
        halt
handler:
        lw    t0, 8(s0)         # MTIMECMP
        addi  t0, t0, 100
        sw    t0, 8(s0)         # the next tick; this also clears the request
        li    t1, 1
        sw    t1, 0x14(s3)      # OUT_TGL: LED 0 flips
        addi  s1, s1, 1
        mret

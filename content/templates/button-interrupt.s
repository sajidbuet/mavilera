# button-interrupt.s -- the push button raises an interrupt; the handler counts it.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a template written for the application).
#
# Compare with gpio-switches.s: here the processor sleeps in wfi and the button wakes it. Three things
# must be on for an interrupt: the device (IRQ_EN bit 8), the machine (mie.MEIE) and the hart
# (mstatus.MIE). The handler must acknowledge the device by writing 1 to IRQ_PEND, or the interrupt
# is taken again at once. The stimulus script presses the button three times; press it yourself too.
# Watch mcause (0x8000000B: an interrupt, external), mepc and the LED count in the Peripherals tab,
# and the request-to-handler latency in its interrupt table.
        .text
main:   la    t0, handler
        csrw  mtvec, t0         # where a trap goes
        li    s0, 0x40000000    # the GPIO
        li    t1, 0x100
        sw    t1, 0x18(s0)      # IRQ_EN: the button may interrupt
        li    t1, 0x800
        csrs  mie, t1           # mie.MEIE: external interrupts may reach the hart
        csrsi mstatus, 8        # mstatus.MIE: the hart takes interrupts
        li    s1, 0             # presses counted
wait:   wfi                     # sleep until an enabled interrupt is pending
        li    t2, 3
        blt   s1, t2, wait
        halt
handler:
        li    t3, 0x100
        sw    t3, 0x1c(s0)      # IRQ_PEND: write 1 to acknowledge the button
        addi  s1, s1, 1         # one more press
        sw    s1, 0(s0)         # the count on the LEDs
        mret                    # back to the interrupted instruction

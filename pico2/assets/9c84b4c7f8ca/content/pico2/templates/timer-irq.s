# timer-irq.s -- An interrupt from TIMER0's ALARM0 through Hazard3's interrupt controller (Xh3irq).
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# ALARM0 raises TIMER0_IRQ_0, interrupt line 0 of the RP2350. Hazard3 takes it as a machine
# external interrupt when the line is enabled in meiea, mie.MEIE is set and mstatus.MIE is set.
# The handler changes the LED on GP25, clears the interrupt and sets the next alarm 50 ms later.
# The main program sleeps (wfi) until the handler has run five times.
# Try: Assemble, then Step until the wfi, then Step again: the core sleeps until the alarm and enters
# isr (mcause 0x8000000b). Run (F5) to the end. Before the final ebreak the program removes its
# handler (mtvec = 0): the simulator ends a program at an ebreak only when no handler is set.
        .text
_start: li      t0, 0x40048000          # XOSC: the 12 MHz crystal, as in blink.s
        li      t1, 47
        sw      t1, 12(t0)
        li      t1, 0x00fabaa0
        sw      t1, 0(t0)
xosc:   lw      t1, 4(t0)
        bgez    t1, xosc
        li      t0, 0x40010000          # CLOCKS: clk_ref and clk_sys from the crystal
        li      t1, 2
        sw      t1, 0x30(t0)
ref:    lw      t1, 0x38(t0)
        andi    t1, t1, 4
        beqz    t1, ref
        li      t1, CLK_SYS_DIV         # the chosen clk_sys (a symbol the assembler defines)
        sw      t1, 0x40(t0)
        li      t1, 0x40
        sw      t1, 0x3c(t0)
sys:    lw      t1, 0x44(t0)
        andi    t1, t1, 1
        beqz    t1, sys
        li      t0, 0x40023000          # RESETS, clear alias: TIMER0, PADS_BANK0, IO_BANK0
        li      t1, 0x00800240
        sw      t1, 0(t0)
        li      t0, 0x40020000
done:   lw      t2, 8(t0)
        and     t2, t2, t1
        bne     t2, t1, done
        li      t0, 0x40108000          # TICKS: TIMER0 counts microseconds
        li      t1, TICK_CYCLES
        sw      t1, 0x1c(t0)
        li      t1, 1
        sw      t1, 0x18(t0)
        li      t0, 0x400280cc          # GP25: SIO output
        li      t1, 5
        sw      t1, 0(t0)
        li      t0, 0x4003b068
        li      t1, 0x180
        sw      t1, 0(t0)
        li      t0, 0xd0000000
        li      t1, 0x02000000
        sw      t1, 0x38(t0)            # GPIO_OE_SET

        la      t0, isr
        csrw    mtvec, t0               # the handler (direct mode: every trap goes to isr)
        li      t0, 0x10000
        csrs    meiea, t0               # Xh3irq: bits 31:16 enable lines 0-15 of window 0 (bits 4:0); line 0 on
        li      t0, 0x800
        csrs    mie, t0                 # MEIE: machine external interrupts
        li      t0, 0x400b0000          # TIMER0
        li      t1, 1
        sw      t1, 0x40(t0)            # INTE: ALARM0 raises TIMER0_IRQ_0
        lw      t1, 0x28(t0)            # TIMERAWL: now
        li      t2, 50000
        add     t1, t1, t2
        sw      t1, 0x10(t0)            # ALARM0: now + 50 ms (writing it arms the alarm)
        csrsi   mstatus, 8              # MIE: interrupts on

        la      s0, ticks
        li      s1, 5
sleep:  wfi                             # sleep until an interrupt is pending
        lw      t0, 0(s0)
        blt     t0, s1, sleep
        csrci   mstatus, 8              # interrupts off
        csrw    mtvec, zero             # no handler: the ebreak ends the program
        ebreak

        .align  2                       # mtvec needs a 4-byte aligned handler
isr:    addi    sp, sp, -16             # an interrupt handler keeps every register it uses
        sw      t0, 0(sp)
        sw      t1, 4(sp)
        sw      t2, 8(sp)
        li      t0, 0x400b0000          # TIMER0
        li      t1, 1
        sw      t1, 0x3c(t0)            # INTR: write 1 to clear ALARM0's interrupt
        lw      t1, 0x10(t0)            # the alarm that fired
        li      t2, 50000
        add     t1, t1, t2
        sw      t1, 0x10(t0)            # the next one, 50 ms after it (no drift)
        li      t0, 0xd0000000
        li      t1, 0x02000000
        sw      t1, 0x28(t0)            # GPIO_OUT_XOR: change the LED
        la      t0, ticks
        lw      t1, 0(t0)
        addi    t1, t1, 1
        sw      t1, 0(t0)               # ticks <- ticks + 1
        lw      t0, 0(sp)
        lw      t1, 4(sp)
        lw      t2, 8(sp)
        addi    sp, sp, 16
        mret

        .data
ticks:  .word   0

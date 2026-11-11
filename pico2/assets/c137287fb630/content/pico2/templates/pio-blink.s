# pio-blink.s -- PIO blinks the LED: a state machine of PIO0 drives GP25 while the core only waits.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# A PIO state machine runs its own small program, one instruction per cycle. This one pulls a count
# from its TX FIFO once, then forever: copies the count into X, sets the pin high, counts X down to
# zero (jmp x-- to itself: one cycle per step), and does the same with the pin low: pio-blink.pio, the
# second tab, which Build assembles with this file. The core loads the six instruction words
# (blink_program) into PIO0's memory, tells state machine 0 which pin SET drives (PINCTRL)
# and where its program wraps (EXECCTRL), starts it, writes the count (a quarter of a second of
# clk_sys cycles) into the FIFO, and waits two seconds on TIMER0: the LED blinks without it.
# Try: Run in Real time and watch GP25 in the Pins panel, and the PIO tab: the program, SM0's PC,
# X counting down. Change the count to blink faster.
        .text
_start: li      t0, 0x40048000          # XOSC
        li      t1, 47
        sw      t1, 12(t0)              # STARTUP: about 1 ms
        li      t1, 0x00fabaa0
        sw      t1, 0(t0)               # CTRL: ENABLE, 1-15 MHz
xosc:   lw      t1, 4(t0)
        bgez    t1, xosc                # wait for STATUS.STABLE (bit 31)
        li      t0, 0x40010000          # CLOCKS
        li      t1, 2
        sw      t1, 0x30(t0)            # CLK_REF_CTRL: clk_ref from the crystal
ref:    lw      t1, 0x38(t0)
        andi    t1, t1, 4
        beqz    t1, ref
        li      t1, CLK_SYS_DIV
        sw      t1, 0x40(t0)            # CLK_SYS_DIV: the chosen clk_sys
        li      t1, 0x40
        sw      t1, 0x3c(t0)            # CLK_SYS_CTRL: clk_sys from clk_ref
sys:    lw      t1, 0x44(t0)
        andi    t1, t1, 1
        beqz    t1, sys
        li      t0, 0x40023000          # RESETS, clear alias
        li      t1, 0x00800a40          # bits 23 TIMER0, 11 PIO0, 9 PADS_BANK0, 6 IO_BANK0
        sw      t1, 0(t0)
        li      t0, 0x40020000
done:   lw      t2, 8(t0)               # RESET_DONE
        and     t2, t2, t1
        bne     t2, t1, done
        li      t0, 0x40108000          # TICKS
        li      t1, TICK_CYCLES
        sw      t1, 0x1c(t0)            # TIMER0_CYCLES: a tick each microsecond
        li      t1, 1
        sw      t1, 0x18(t0)            # TIMER0_CTRL: ENABLE
        li      t0, 0x400280cc          # IO_BANK0 GPIO25_CTRL
        li      t1, 6
        sw      t1, 0(t0)               # function 6: PIO0
        li      t0, 0x4003b068          # PADS_BANK0 GPIO25, clear alias
        li      t1, 0x180
        sw      t1, 0(t0)               # clear ISO and OD
        li      s0, 0x50200000          # PIO0
        la      t0, blink_program       # the program's words (halfwords, from pio-blink.pio)
        addi    t1, s0, 0x48            # INSTR_MEM0
        li      t2, blink_length
load:   lhu     t3, 0(t0)
        sw      t3, 0(t1)               # one instruction word
        addi    t0, t0, 2
        addi    t1, t1, 4
        addi    t2, t2, -1
        bnez    t2, load
        li      t1, (1 << 26) | (25 << 5)
        sw      t1, 0xdc(s0)            # SM0_PINCTRL: SET drives 1 pin from GP25
        li      t1, (blink_wrap << 12) | (blink_wrap_target << 7)
        sw      t1, 0xcc(s0)            # SM0_EXECCTRL: wrap from blink_wrap back to blink_wrap_target
        li      t1, 0xe081
        sw      t1, 0xd8(s0)            # SM0_INSTR: set pindirs, 1 (run at once): GP25 is an output
        li      t1, 1
        sw      t1, 0(s0)               # CTRL: SM_ENABLE bit 0, state machine 0 runs from address 0
        li      t1, CLK_SYS_HZ / 4 - 3
        sw      t1, 0x10(s0)            # TXF0: the count, a quarter of a second per half period
        li      a0, 2000000
        call    wait                    # two seconds; the state machine blinks meanwhile
        mv      a0, zero
        ebreak

# wait(a0): until TIMER0 has counted a0 microseconds
wait:   li      t0, 0x400b0028          # TIMER0 TIMERAWL
        lw      t1, 0(t0)
poll:   lw      t2, 0(t0)
        sub     t2, t2, t1
        bltu    t2, a0, poll
        ret

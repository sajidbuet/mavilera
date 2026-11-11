# pio-square.s -- A square wave from PIO with side-set: 440 Hz on GP14, the speaker pin.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# Side-set lets an instruction drive a pin besides doing its own work. Here the instructions do
# nothing (nop) and their side-set makes the wave: high for 16 state machine cycles (the nop and 15
# delay cycles), low for 16 (pio-square.pio, the second tab, which Build assembles with this file). The state machine's clock divider makes 32 of its cycles one period of
# 440 Hz: clk_sys / (440 x 32) system cycles per state machine cycle, a 16.8 fixed-point number in
# SM0_CLKDIV (here CLK_SYS_HZ x 256 / 14080, shifted into place). The core starts it and waits a second.
# Try: turn Sound on (the speaker button) and Run in Real time: you hear an A. Change 14080 to
# 440 x 32 x 2 for the A below. The PIO tab shows the divider and the two-instruction program.
        .text
_start: li      t0, 0x40048000          # XOSC
        li      t1, 47
        sw      t1, 12(t0)              # STARTUP: about 1 ms
        li      t1, 0x00fabaa0
        sw      t1, 0(t0)               # CTRL: ENABLE, 1-15 MHz
xosc:   lw      t1, 4(t0)
        bgez    t1, xosc
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
done:   lw      t2, 8(t0)
        and     t2, t2, t1
        bne     t2, t1, done
        li      t0, 0x40108000          # TICKS
        li      t1, TICK_CYCLES
        sw      t1, 0x1c(t0)            # TIMER0_CYCLES
        li      t1, 1
        sw      t1, 0x18(t0)            # TIMER0_CTRL: ENABLE
        li      t0, 0x40028074          # IO_BANK0 GPIO14_CTRL
        li      t1, 6
        sw      t1, 0(t0)               # function 6: PIO0
        li      t0, 0x4003b03c          # PADS_BANK0 GPIO14, clear alias
        li      t1, 0x180
        sw      t1, 0(t0)               # clear ISO and OD
        li      s0, 0x50200000          # PIO0
        la      t0, square_program      # the two words, from pio-square.pio
        lhu     t1, 0(t0)
        sw      t1, 0x48(s0)            # INSTR_MEM0
        lhu     t1, 2(t0)
        sw      t1, 0x4c(s0)            # INSTR_MEM1
        li      t1, (CLK_SYS_HZ * 256 / 14080) << 8
        sw      t1, 0xc8(s0)            # SM0_CLKDIV: clk_sys / (440 x 32), 16.8 fixed point
        li      t1, (1 << 29) | (14 << 10) | (1 << 26) | (14 << 5)
        sw      t1, 0xdc(s0)            # SM0_PINCTRL: side-set 1 pin from GP14; SET 1 pin from GP14
        li      t1, (square_wrap << 12) | (square_wrap_target << 7)
        sw      t1, 0xcc(s0)            # SM0_EXECCTRL: the wrap
        li      t1, 0xe081
        sw      t1, 0xd8(s0)            # SM0_INSTR: set pindirs, 1 (at once): GP14 is an output
        li      t1, 1
        sw      t1, 0(s0)               # CTRL: start state machine 0
        li      a0, 1000000
        call    wait                    # one second of sound
        mv      a0, zero
        ebreak

# wait(a0): until TIMER0 has counted a0 microseconds
wait:   li      t0, 0x400b0028          # TIMER0 TIMERAWL
        lw      t1, 0(t0)
poll:   lw      t2, 0(t0)
        sub     t2, t2, t1
        bltu    t2, a0, poll
        ret

# blink.s -- Blink the Pico 2's LED on GP25: the SIO drives the pin, TIMER0 times it.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# The start-up runs the chip from its 12 MHz crystal at the clk_sys chosen in the toolbar
# (CLK_SYS_DIV and TICK_CYCLES are symbols the assembler defines), releases IO_BANK0, PADS_BANK0 and TIMER0
# from reset and makes TIMER0 count microseconds. GP25 then becomes an SIO output, and the LED
# changes ten times, 100 ms apart. (On a Pico 2 W the LED is on the wireless chip: GP25 is a pin.)
# Try: Assemble, then Run (F5); the run takes one simulated second. Step through wait and watch
# TIMERAWL grow while the loop polls it.
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
        sw      t1, 0x40(t0)            # CLK_SYS_DIV: clk_ref / divisor = the chosen clk_sys
        li      t1, 0x40
        sw      t1, 0x3c(t0)            # CLK_SYS_CTRL: clk_sys from clk_ref
sys:    lw      t1, 0x44(t0)
        andi    t1, t1, 1
        beqz    t1, sys
        li      t0, 0x40023000          # RESETS, clear alias
        li      t1, 0x00800240          # bits 23 TIMER0, 9 PADS_BANK0, 6 IO_BANK0
        sw      t1, 0(t0)
        li      t0, 0x40020000
done:   lw      t2, 8(t0)               # RESET_DONE
        and     t2, t2, t1
        bne     t2, t1, done
        li      t0, 0x40108000          # TICKS
        li      t1, TICK_CYCLES
        sw      t1, 0x1c(t0)            # TIMER0_CYCLES: a tick every 12 cycles of clk_ref = 1 us
        li      t1, 1
        sw      t1, 0x18(t0)            # TIMER0_CTRL: ENABLE
        li      t0, 0x400280cc          # IO_BANK0 GPIO25_CTRL
        li      t1, 5
        sw      t1, 0(t0)               # function 5: SIO
        li      t0, 0x4003b068          # PADS_BANK0 GPIO25, clear alias
        li      t1, 0x180
        sw      t1, 0(t0)               # clear ISO and OD (output disable)
        li      s0, 0xd0000000          # SIO
        li      s1, 0x02000000          # 1 << 25
        sw      s1, 0x38(s0)            # GPIO_OE_SET: GP25 drives
        li      s2, 10                  # ten changes
blink:  sw      s1, 0x28(s0)            # GPIO_OUT_XOR: change GP25
        li      a0, 100000
        call    wait                    # 100 ms
        addi    s2, s2, -1
        bnez    s2, blink
        ebreak

# wait(a0): until TIMER0 has counted a0 microseconds (an unsigned difference, right across the wrap)
wait:   li      t0, 0x400b0028          # TIMER0 TIMERAWL
        lw      t1, 0(t0)               # the start
poll:   lw      t2, 0(t0)
        sub     t2, t2, t1
        bltu    t2, a0, poll
        ret

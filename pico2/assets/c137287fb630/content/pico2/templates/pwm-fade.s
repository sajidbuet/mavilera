# pwm-fade.s -- Fade the Pico 2's LED with PWM: slice 4 drives GP25, the program changes its level.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# GP25 takes function 4 (PWM): it is output B of slice 4 (slice = (pin >> 1) & 7, B for an odd pin).
# The slice counts 0 to TOP = 999 at clk_sys, so one period is 1000 cycles; the pin is high while
# the count is below the level in CC (bits 31:16 for B). The program raises the level by 50 every
# 10 ms to 1000 (100 %), then lowers it back to 0: 0.4 s of fading up and down.
# A new CC applies at the next wrap (the count going back to 0): the PWM's double buffering.
# Try: Assemble, then Run, and watch GP25's lamp in the Pins panel; step through the loop and see
# CH4_CC change in the PWM tab of the memory pane while CH4_CTR runs on.
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
        li      t1, 0x00810240          # bits 23 TIMER0, 16 PWM, 9 PADS_BANK0, 6 IO_BANK0
        sw      t1, 0(t0)
        li      t0, 0x40020000
done:   lw      t2, 8(t0)               # RESET_DONE
        and     t2, t2, t1
        bne     t2, t1, done
        li      t0, 0x40108000          # TICKS
        li      t1, TICK_CYCLES
        sw      t1, 0x1c(t0)            # TIMER0_CYCLES: 1 us ticks
        li      t1, 1
        sw      t1, 0x18(t0)            # TIMER0_CTRL: ENABLE
        li      t0, 0x400280cc          # IO_BANK0 GPIO25_CTRL
        li      t1, 4
        sw      t1, 0(t0)               # function 4: PWM (slice 4, output B)
        li      t0, 0x4003b068          # PADS_BANK0 GPIO25, clear alias
        li      t1, 0x180
        sw      t1, 0(t0)               # clear ISO and OD
        li      s0, 0x400a8050          # PWM CH4_CSR (slice 4: 0x400a8000 + 4 x 0x14)
        li      t1, 999
        sw      t1, 0x10(s0)            # CH4_TOP: count 0..999
        sw      zero, 0x0c(s0)          # CH4_CC: level 0
        li      t1, 1
        sw      t1, 0(s0)               # CH4_CSR: EN (divider 1: the reset value of CH4_DIV)
        li      s1, 0                   # the level
        li      s2, 50                  # the step: +50, later -50
        li      s3, 40                  # 20 steps up, 20 down
fade:   add     s1, s1, s2
        slli    t1, s1, 16              # B's level in CC bits 31:16
        sw      t1, 0x0c(s0)            # CH4_CC: applies at the next wrap
        li      a0, 10000
        call    wait                    # 10 ms
        addi    s3, s3, -1
        li      t1, 20
        bne     s3, t1, same
        neg     s2, s2                  # at the top: down again
same:   bnez    s3, fade
        sw      zero, 0(s0)             # CH4_CSR: stop the slice
        mv      a0, s1                  # the final level: 0
        ebreak

# wait(a0): until TIMER0 has counted a0 microseconds
wait:   li      t0, 0x400b0028          # TIMER0 TIMERAWL
        lw      t1, 0(t0)
poll:   lw      t2, 0(t0)
        sub     t2, t2, t1
        bltu    t2, a0, poll
        ret

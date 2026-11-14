# gpio-leds.s -- GPIO output: a running light, then OUT_SET, OUT_CLR and OUT_TGL.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a template written for the application).
#
# The profile is "ISA with traps and devices". Open the Peripherals tab of the Memory and cache panel
# to see the eight LEDs. Run with the speed set to Animated: one LED travels along the row, then
# three writes to other registers change several LEDs at once. Final pattern: 0xF5.
#   OUT      0x40000000  the LEDs (bit n lights LED n)
#   OUT_SET  0x4000000C  write 1s to turn LEDs on, the others stay
#   OUT_CLR  0x40000010  write 1s to turn LEDs off, the others stay
#   OUT_TGL  0x40000014  write 1s to flip LEDs
        .text
main:   li   s0, 0x40000000     # the GPIO
        li   t0, 0xff
        sw   t0, 8(s0)          # DIR: eight outputs (kept in the register; the LEDs follow OUT)
        li   s1, 1              # the LED that is lit
        li   s2, 0x100          # one past the last LED
scan:   sw   s1, 0(s0)          # OUT: one LED on
        li   t1, 10
wait:   addi t1, t1, -1         # a short delay, so that the light can be seen
        bnez t1, wait
        slli s1, s1, 1          # the next LED
        bne  s1, s2, scan
        sw   zero, 0(s0)        # OUT: all LEDs off
        li   t0, 0x0f
        sw   t0, 0xc(s0)        # OUT_SET:  LEDs 0 to 3 on        -> 0x0f
        li   t0, 0x05
        sw   t0, 0x10(s0)       # OUT_CLR:  LEDs 0 and 2 off      -> 0x0a
        li   t0, 0xff
        sw   t0, 0x14(s0)       # OUT_TGL:  every LED flips       -> 0xf5
        halt

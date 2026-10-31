# gpio-switches.s -- GPIO input: polling the switches and the push button.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a template written for the application).
#
# The program copies the four switches (IN bits 7 to 4) onto LEDs 0 to 3, over and over, until the push
# button (IN bit 8) is pressed. This is polling: the processor spends its time asking. In the
# Peripherals tab click the switches and press the button (Space or Enter work too) while you step.
# The stimulus script already moves the switches at cycles 60 and 160 and presses the button at 300,
# so a plain Run ends with the LEDs showing 0xA.
        .text
main:   li   s0, 0x40000000     # the GPIO
poll:   lw   t0, 4(s0)          # IN: the pins as they are now
        srli t1, t0, 4
        andi t1, t1, 0xf        # the four switches
        sw   t1, 0(s0)          # onto LEDs 0 to 3
        andi t2, t0, 0x100      # the push button
        beqz t2, poll           # not pressed: ask again
        halt

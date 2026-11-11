# timer-poll.s -- the machine timer read by polling: a delay of 50 time units, six times.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a template written for the application).
#
# MTIME (0x40001000) counts up by one every cycle. The program reads it, adds 50, and reads it
# again until it has passed that value (an unsigned compare), then flips LED 0. In the Peripherals tab
# watch MTIME advance and the bar fill. Step a few times, then run: a delay made of polling keeps the
# processor busy; timer-interrupt.s does the same job without that.
        .text
main:   li   s0, 0x40001000     # the timer
        li   s1, 0x40000000     # the GPIO
        li   s2, 0              # blinks done
again:  lw   t0, 0(s0)          # MTIME (low word)
        addi t0, t0, 50         # the time to wait for
wait:   lw   t1, 0(s0)
        bltu t1, t0, wait       # not yet
        li   t2, 1
        sw   t2, 0x14(s1)       # OUT_TGL: LED 0 flips
        addi s2, s2, 1
        li   t3, 6
        blt  s2, t3, again
        halt

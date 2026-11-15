# watch-overrun.s -- Catching a write past the end of an array.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# The loop is meant to clear buf[0..3] but runs five times, and its last store
# lands on limit, the word after the array. Try: in the Memory pane type limit,
# press Watch, then Run (F5): the run stops at the store that overwrites it.
# Step back (Shift+F10) to see the state just before. The fix: blt, not ble.
        .data
buf:    .word 7, 7, 7, 7        # four words
limit:  .word 1000              # the word just after the array
        .text
main:   la   t0, buf
        li   t1, 0              # index
        li   t3, 4              # number of elements
fill:   slli t2, t1, 2
        add  t2, t0, t2
        sw   t1, 0(t2)          # buf[t1] = t1
        addi t1, t1, 1
        ble  t1, t3, fill       # bug: runs for t1 = 0..4
        la   t4, limit
        lw   a0, 0(t4)          # 4, not 1000
        li   a7, 93
        ecall

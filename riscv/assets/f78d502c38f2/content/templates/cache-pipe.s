# cache-pipe.s -- The pipeline waits for memory: a cache makes most waits vanish.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# Open the Memory setting: main memory takes 6 cycles per word, with a cache on
# each side (1 KiB, direct-mapped). Run to the halt and read "Memory wait
# cycles" in the Cache tab (Statistics): the waits come at the first fetch of
# each block of code and at the first load of each block of data, then the loop
# runs from the cache. Choose "Main memory, no cache" in the Memory setting and
# run again: every instruction waits, and the program takes several times as
# many cycles. (Memory waits freeze the whole pipeline in this model.)
        addi t0, zero, 512      # the array lies at 0x200 (memory size 1024 words)
        addi t1, zero, 16
        addi a0, zero, 0
init:   sw   t1, 0(t0)
        addi t0, t0, 4
        addi t1, t1, -1
        bne  t1, zero, init
        addi t0, zero, 512
        addi t1, zero, 16
sum:    lw   t2, 0(t0)
        add  a0, a0, t2
        addi t0, t0, 4
        addi t1, t1, -1
        bne  t1, zero, sum
        halt
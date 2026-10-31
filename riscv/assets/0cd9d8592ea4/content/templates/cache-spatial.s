# cache-spatial.s -- Spatial locality: a sequential walk misses once per block.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a RISC-VISTA template, written for the application).
#
# The Memory setting of this template is a direct-mapped data cache with 16-byte
# blocks (four words). Try: open the Cache tab at the bottom (data cache) and
# Step (F10). The first lw misses and fetches the whole block; the next three
# words are already there and hit, so the loop misses once in four loads: 8
# misses and 24 hits in all. Watch the animation under "Last access" and the
# line that fills, set by set, as t0 walks the array.
        .data
nums:   .word 1, 2, 3, 4, 5, 6, 7, 8
        .word 9, 10, 11, 12, 13, 14, 15, 16
        .word 17, 18, 19, 20, 21, 22, 23, 24
        .word 25, 26, 27, 28, 29, 30, 31, 32
        .text
main:   la   t0, nums
        li   t1, 32             # elements left
        li   a0, 0              # a0 = sum
loop:   lw   t2, 0(t0)
        add  a0, a0, t2
        addi t0, t0, 4          # the next word: usually the same block
        addi t1, t1, -1
        bnez t1, loop
        li   a7, 93
        ecall                   # exit code = 528
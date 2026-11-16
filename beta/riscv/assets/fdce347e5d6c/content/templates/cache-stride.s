# cache-stride.s -- Stride: touching one word per block misses every time.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# Same cache as "Spatial locality" (16-byte blocks). The stride in s1 is the
# distance in bytes between the loads. With 16, every load lands in a new
# block: 16 loads, 16 misses, all compulsory, and the other three words of each
# block fetched for nothing. Change "li s1, 16" to "li s1, 4" and assemble
# again: 64 loads, still 16 misses (one per block). The exit code is the number
# of loads, so the run is easy to check.
        .data
arr:    .space 256              # 64 words
        .text
main:   la   t0, arr
        li   s1, 16             # the stride in bytes
        li   t1, 256            # bytes of the array
        li   a0, 0              # a0 = loads made
        add  t3, t0, t1         # t3 = end of the array
loop:   lw   t2, 0(t0)
        addi a0, a0, 1
        add  t0, t0, s1
        blt  t0, t3, loop
        li   a7, 93
        ecall                   # exit code = 16 (stride 16) or 64 (stride 4)
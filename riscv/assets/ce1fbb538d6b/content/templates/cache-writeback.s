# cache-writeback.s -- Write-back: a dirty line is written to memory only when it is replaced.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# A write-back, write-allocate data cache (1 KiB, direct-mapped, 16-byte
# blocks). The eight stores miss twice (one per block) and hit six times: the
# two lines become dirty and main memory is not written at all. The loads from
# arrB, 1 KiB further on, use the same two sets and replace the dirty lines:
# each is written back before the new block is fetched (2 write-backs). Step
# slowly and watch the D marks and the animation: "eviction", "written back",
# "fill". Then choose the write-through preset in the Memory setting: every
# store goes to memory at once (8 write-throughs) and nothing is ever dirty.
        .data
arrA:   .space 1024
arrB:   .word 1, 2, 3, 4, 5, 6, 7, 8
        .text
main:   la   t0, arrA
        li   t1, 8
        li   t2, 100
fill:   sw   t2, 0(t0)
        addi t2, t2, 1
        addi t0, t0, 4
        addi t1, t1, -1
        bnez t1, fill
        la   t0, arrB
        li   t1, 8
        li   a0, 0
sum:    lw   t3, 0(t0)
        add  a0, a0, t3
        addi t0, t0, 4
        addi t1, t1, -1
        bnez t1, sum
        li   a7, 93
        ecall                   # exit code = 36
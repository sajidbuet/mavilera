# cache-conflict.s -- Conflict misses: two arrays that share the same sets.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a RISC-VISTA template, written for the application).
#
# A 1 KiB direct-mapped data cache with 16-byte blocks has 64 sets, so two
# addresses 1024 bytes apart use the same set. Here arrB lies exactly 1 KiB
# after arrA: A[i] and B[i] fight for one line and every one of the 16 loads
# misses (4 compulsory, 12 conflict: the cache is not full, it just has no
# second way). Open the Memory setting (the Memory button) and make the data
# cache 2-way: then A[i] and B[i] sit side by side and only the 4 compulsory
# misses remain. The Statistics tab splits the misses by kind.
        .data
arrA:   .word 1, 2, 3, 4, 5, 6, 7, 8
        .space 992              # arrB starts 1024 bytes after arrA
arrB:   .word 10, 20, 30, 40, 50, 60, 70, 80
        .text
main:   la   t0, arrA
        la   t1, arrB
        li   t3, 8              # elements left
        li   a0, 0
loop:   lw   t4, 0(t0)
        lw   t5, 0(t1)
        add  a0, a0, t4
        add  a0, a0, t5
        addi t0, t0, 4
        addi t1, t1, 4
        addi t3, t3, -1
        bnez t3, loop
        li   a7, 93
        ecall                   # exit code = 36 + 360 = 396
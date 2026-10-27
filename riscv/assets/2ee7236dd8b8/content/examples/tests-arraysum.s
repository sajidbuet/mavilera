# tests-arraysum.s -- Sum of a word array.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        .data
arr:    .word 12, -5, 300, 0x7fffffff, -2048, 77, 0, 9
n:      .word 8
        .text
_start: la    t0, arr
        la    t1, n
        lw    t1, 0(t1)          # element count
        li    a0, 0
loop:   beqz  t1, done
        lw    t2, 0(t0)
        add   a0, a0, t2
        addi  t0, t0, 4
        addi  t1, t1, -1
        j     loop
done:   li    a7, 93             # exit(a0)
        ecall

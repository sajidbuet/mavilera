# sum-loop.s -- A counted loop over an array.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# Try: click the line number of bnez to set a breakpoint, then Run (F5) several
# times: each run stops after one more iteration. Watch t0 walk the array four
# bytes at a time, t1 count down and a0 grow. The Counters pane shows how many
# loads, ALU instructions and taken branches the loop costs.
        .data
nums:   .word 12, -5, 7, 30, 1, -9, 4, 20
        .text
main:   la   t0, nums           # t0 points at the next element
        li   t1, 8              # t1 = elements left
        li   a0, 0              # a0 = sum
loop:   lw   t2, 0(t0)
        add  a0, a0, t2
        addi t0, t0, 4          # next word: four bytes on
        addi t1, t1, -1
        bnez t1, loop           # eight iterations
        li   a7, 93
        ecall                   # exit code = sum = 60

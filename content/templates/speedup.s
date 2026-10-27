# speedup.s -- One program on three processors.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a RISC-VISTA template, written for the application).
#
# Fills 16 words and finds the largest. Try: open the Compare view: the
# single-cycle processor needs one long cycle per instruction, the multicycle
# processor several short ones, the pipeline about one short cycle each. The
# table gives cycles, CPI, the clock period and the execution time of each, and
# the speed-up over the single-cycle processor. The data are placed by the
# assembler (.data), where each processor keeps them.
        .data
arr:    .space 64               # 16 words
        .text
        la   x10, arr
        addi x5, x0, 16
        addi x6, x10, 0
        addi x7, x0, 7
fill:   sw   x7, 0(x6)
        addi x7, x7, 13
        andi x7, x7, 63         # a pseudo-random pattern below 64
        addi x6, x6, 4
        addi x5, x5, -1
        bne  x5, x0, fill
        addi x5, x0, 16
        addi x6, x10, 0
        addi x11, x0, 0         # x11 = the largest so far
max:    lw   x8, 0(x6)
        slt  x9, x11, x8
        beq  x9, x0, keep
        addi x11, x8, 0
keep:   addi x6, x6, 4
        addi x5, x5, -1
        bne  x5, x0, max
        addi x6, x0, 0          # clear the two pointers: the multicycle processor keeps
        addi x10, x0, 0         # its data at 0x200, so addresses differ between processors
        halt

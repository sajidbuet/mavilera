# cpi-mix.s -- Cycles per instruction on the multicycle processor.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# Each class takes its own number of cycles: ALU instructions 4, loads 5,
# stores 4, branches 3. Try: run the first loop to its end (a breakpoint on the
# second addi x5) and read cycles and CPI in the Counters pane; then run on to
# the halt. The load loop raises the CPI. The "States over time" tab shows the
# states of every instruction.
        addi x5, x0, 10         # part 1: an ALU loop
alu:    addi x6, x6, 3
        add  x7, x7, x6
        addi x5, x5, -1
        bne  x5, x0, alu
        addi x10, x0, 0x200     # part 2: a load loop (data start at 0x200)
        addi x5, x0, 10
ld:     lw   x8, 0(x10)
        lw   x9, 4(x10)
        add  x7, x8, x9
        addi x5, x5, -1
        bne  x5, x0, ld
        halt

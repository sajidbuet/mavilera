# class-tour.s -- One instruction of each class on the single-cycle processor.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# Try: step (F10) one clock cycle at a time and watch which paths each class
# uses on the datapath. Open the Timing tab: the critical path of each class is
# listed, and lw, which passes through both memories, sets the clock period.
        addi x5, x0, 64         # I-type ALU
        addi x6, x0, 3
        add  x7, x5, x6         # R-type: 67
        sw   x7, 0(x5)          # store
        lw   x8, 0(x5)          # load: the longest path
        beq  x7, x8, skip       # branch, taken (67 = 67)
        addi x9, x0, 1          # skipped
skip:   jal  x1, next           # jump and link: x1 = return address
next:   lui  x10, 0x12345       # upper immediate
        auipc x11, 0            # PC-relative
        halt

# predictor-aliasing.s -- Two branches sharing one predictor entry.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a RISC-VISTA template, written for the application).
#
# The branch-history table is indexed by a few bits of the PC. With ENTRIES = 2
# only bit 2 is used, and the three branches below (at 0x4, 0xc and 0x14) all
# share one entry: the always-taken beq and the never-taken bne keep
# overwriting each other's history. Try: Predictor "2-bit", ENTRIES 2, run;
# then ENTRIES 8 (each branch its own entry) and run again: fewer
# mispredictions. The Predictor tab shows which entry each branch reads.
        addi x5, x0, 8          # 0x00
loop:   beq  x0, x0, l1         # 0x04: always taken
l1:     addi x6, x6, 1          # 0x08
        bne  x0, x0, l2         # 0x0c: never taken
l2:     addi x5, x5, -1         # 0x10
        bne  x5, x0, loop       # 0x14: the loop
        halt

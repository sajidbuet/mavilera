# hazard-unit-steps.s -- What each part of the hazard unit is for.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# Try: set Hazards above the drawing to each setting in turn, from "Stub: none"
# to "Complete", and run to the halt each time. x6 should end as 8. Without
# forwarding the additions read stale registers; with forwarding but no
# load-use stall the add after the load still reads too early; only the two
# settings with the stall give 8.
# The Hazards tab explains each cycle; the CPI tab counts stale reads.
        addi x1, x0, 1
        addi x2, x1, 1          # x1 from MEM: 2
        addi x3, x2, 1          # x2 from MEM: 3
        add  x4, x3, x1         # 4
        addi x10, x0, 64
        sw   x4, 0(x10)
        lw   x5, 0(x10)
        add  x6, x5, x5         # load-use: needs the stall; 8
        halt

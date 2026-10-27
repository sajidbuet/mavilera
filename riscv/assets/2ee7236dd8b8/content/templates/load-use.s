# load-use.s -- The load-use stall, and how scheduling avoids it.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a RISC-VISTA template, written for the application).
#
# A loaded value is ready only at the end of MEM, too late to forward to the
# instruction right behind the load: that instruction waits one cycle (a bubble).
# Try: run and open the Pipeline diagram: the first block stalls twice. The
# second block does the same work with the loads first, and does not stall.
# The Run summary tab lists both stalls.
        addi x10, x0, 64        # a small array at 64
        addi x1, x0, 3
        sw   x1, 0(x10)
        addi x1, x0, 4
        sw   x1, 4(x10)
        addi x1, x0, 5
        sw   x1, 8(x10)
        addi x1, x0, 6
        sw   x1, 12(x10)
        lw   x1, 0(x10)         # in the order written:
        lw   x2, 4(x10)
        add  x3, x1, x2         # x2 loaded just before: stall
        lw   x4, 8(x10)
        lw   x5, 12(x10)
        add  x6, x4, x5         # stall
        lw   x11, 0(x10)        # scheduled: the loads first
        lw   x12, 4(x10)
        lw   x14, 8(x10)
        lw   x15, 12(x10)
        add  x13, x11, x12      # no stall
        add  x16, x14, x15      # no stall
        halt

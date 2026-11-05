# jumps.s -- Calls and returns in the pipeline.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# jal and jalr always change the flow: resolved in EX, each costs two flushed
# instructions. Try: run and count the redirects in the CPI tab; then set
# "Resolve in" to ID (an extension: the jump is resolved one stage earlier) and
# run again: each redirect now costs one cycle instead of two. A branch resolved
# in ID may have to wait there for its operand: the Hazards tab shows when.
        addi x10, x0, 0
        addi x5, x0, 3
loop:   jal  x1, inc            # call: two cycles lost
        addi x5, x5, -1
        bne  x5, x0, loop
        halt
inc:    addi x10, x10, 1
        jalr x0, 0(x1)          # return: two cycles lost

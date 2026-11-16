# branch-loop.s -- The cost of a taken branch, and a predictor that learns.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# With no predictor every branch is predicted not taken, so each taken bne is
# resolved in EX and the two instructions fetched behind it are flushed: two
# cycles lost per iteration. Try: run with Predictor "None" and note the cycles
# and CPI; choose "2-bit" (the program restarts) and run again: the predictor
# learns that the branch is taken, and mispredicts only the first iteration and
# the exit.
        addi x5, x0, 10
        addi x6, x0, 0
loop:   addi x6, x6, 2
        addi x5, x5, -1
        bne  x5, x0, loop       # taken 9 times, then not taken
        halt

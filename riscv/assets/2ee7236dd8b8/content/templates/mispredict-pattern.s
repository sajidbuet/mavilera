# mispredict-pattern.s -- Nested loops: 1-bit and 2-bit prediction.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a RISC-VISTA template, written for the application).
#
# The inner branch is taken three times, then falls through, again and again.
# A 1-bit predictor remembers only the last outcome: it mispredicts the exit and
# then the first iteration of the next round, twice per round. A 2-bit counter
# needs two wrong guesses to change its mind: once trained it mispredicts only
# the exit. Try: run with Predictor "1-bit", then "2-bit", and compare the
# mispredictions in the Predictor and CPI tabs.
        addi x7, x0, 6          # outer loop: 6 rounds
outer:  addi x5, x0, 4          # inner loop: 4 iterations
inner:  addi x6, x6, 1
        addi x5, x5, -1
        bne  x5, x0, inner
        addi x7, x7, -1
        bne  x7, x0, outer
        halt

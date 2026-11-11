# load-use.s -- Load-use stalls and branch costs on Hazard3's three-stage pipeline.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# Two loops add the same eight words. In the first, add uses t0 in the cycle after lw loads it:
# X must wait one cycle for M (a load-use stall). The second loop moves an independent addi
# between them, so no stall. mcycle is read before and after each loop (the counters are
# inhibited at reset: the first instruction turns them on). At the end
#   s3 = cycles of loop 1, s4 = cycles of loop 2, s3 - s4 = 8: one stall per iteration.
# Both loops end with a taken backward branch: after the first iteration Hazard3's branch
# predictor remembers it, and the last iteration, not taken, costs a misprediction.
# Try: Assemble in the Pipeline view, step cycle by cycle and look for the stall in X and the
# bubble after the mispredicted branch; compare CPI by cause.
        .text
_start: csrw    mcountinhibit, zero     # count cycles and instructions
        csrr    s2, mcycle
        la      a0, table
        li      a1, 8
        li      a2, 0
one:    lw      t0, 0(a0)
        add     a2, a2, t0              # needs t0 at once: one stall cycle
        addi    a0, a0, 4
        addi    a1, a1, -1
        bnez    a1, one
        csrr    s3, mcycle
        la      a0, table
        li      a1, 8
        li      a3, 0
two:    lw      t0, 0(a0)
        addi    a0, a0, 4               # independent: fills the cycle the load needs
        add     a3, a3, t0
        addi    a1, a1, -1
        bnez    a1, two
        csrr    s4, mcycle
        sub     s4, s4, s3              # cycles of loop 2 (with its la and li)
        sub     s3, s3, s2              # cycles of loop 1 (with its la and li)
        ebreak

        .data
table:  .word   3, 1, 4, 1, 5, 9, 2, 6

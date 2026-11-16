# zcmp-call.s -- A recursive function with cm.push and cm.popret (Zcmp).
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# fact(n) = n x fact(n - 1). Each call saves ra and s0 with one 16-bit cm.push and restores them,
# frees its frame and returns with one cm.popret. Hazard3 runs them as micro-operations:
# cm.push of two registers takes 1 + 2 cycles, cm.popret one more for the return.
# At the end a0 = fact(6) = 720.
# Try: Assemble in the Core view and step through a cm.push: X holds it for several cycles
# while M stores one register per cycle. Watch sp in the Registers panel.
        .text
_start: li      a0, 6
        call    fact
        ebreak

# fact(a0): a0 <- a0!
fact:   cm.push   {ra, s0}, -16         # save ra and s0, sp <- sp - 16
        mv        s0, a0
        li        t0, 1
        ble       a0, t0, base          # 0! = 1! = 1
        addi      a0, a0, -1
        call      fact                  # a0 <- (n - 1)!
        mul       a0, a0, s0            # n x (n - 1)!
        cm.popret {ra, s0}, 16          # restore ra and s0, sp <- sp + 16, return
base:   li        a0, 1
        cm.popret {ra, s0}, 16

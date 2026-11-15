# tests-fact.s -- Recursive factorial with the standard calling convention and the stack.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        .text
_start: li    a0, 12
        call  fact
        li    a7, 93
        ecall

fact:   addi  sp, sp, -16
        sw    ra, 12(sp)
        sw    s0, 8(sp)
        mv    s0, a0
        li    t0, 1
        ble   a0, t0, base       # fact(n) = 1 for n <= 1
        addi  a0, a0, -1
        call  fact
        mul   a0, a0, s0
        j     out
base:   li    a0, 1
out:    lw    s0, 8(sp)
        lw    ra, 12(sp)
        addi  sp, sp, 16
        ret

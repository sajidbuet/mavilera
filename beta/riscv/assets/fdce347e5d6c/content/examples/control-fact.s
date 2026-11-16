# control-fact.s -- Recursive factorial.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
_start: li    a0, 3
        call  fact
        li    a7, 93
        ecall

# fact(n) = 1 if n <= 1, else n * fact(n - 1).
fact:   addi  sp, sp, -16       # ra, s0, 8 bytes padding
        sw    ra, 12(sp)
        sw    s0, 8(sp)
        mv    s0, a0            # keep n across the call
        li    t0, 1
        ble   a0, t0, base
        addi  a0, a0, -1
        call  fact              # a0 = fact(n - 1)
        mul   a0, a0, s0        # n * fact(n - 1)
        j     out
base:   li    a0, 1
out:    lw    s0, 8(sp)
        lw    ra, 12(sp)
        addi  sp, sp, 16
        ret

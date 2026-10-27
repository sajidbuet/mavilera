# control-paths.s -- The number of monotone paths across an m x n grid of blocks, paths(m, n) = paths(m - 1, n) + paths(m, n - 1), with paths(0, n) = paths(m, 0) = 1.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
_start: li    a0, 3
        li    a1, 3
        call  paths
        li    a7, 93
        ecall

paths:  beqz  a0, one           # m == 0
        beqz  a1, one           # n == 0
        addi  sp, sp, -16       # frame: ra, s0 = m, s1 = n, s2 = first result
        sw    ra, 12(sp)
        sw    s0, 8(sp)
        sw    s1, 4(sp)
        sw    s2, 0(sp)
        mv    s0, a0
        mv    s1, a1
        addi  a0, a0, -1
        call  paths             # paths(m - 1, n)
        mv    s2, a0
        mv    a0, s0
        addi  a1, s1, -1
        call  paths             # paths(m, n - 1)
        add   a0, a0, s2
        lw    s2, 0(sp)
        lw    s1, 4(sp)
        lw    s0, 8(sp)
        lw    ra, 12(sp)
        addi  sp, sp, 16
        ret
one:    li    a0, 1             # base case: no frame needed
        ret

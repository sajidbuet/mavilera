# control-sum_index.s -- Sum of an array of n words by index.
# Exit code = the sum.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        la    a0, arr           # base
        li    a1, 8             # n
        li    t0, 0             # i
        li    t1, 0             # sum
loop:   bge   t0, a1, done      # while i < n
        slli  t2, t0, 2         # 4i
        add   t2, a0, t2        # address of arr[i]
        lw    t3, 0(t2)
        add   t1, t1, t3
        addi  t0, t0, 1         # i = i + 1
        j     loop
done:   mv    a0, t1
        li    a7, 93
        ecall
        .data
arr:    .word 4, 8, 15, 16, 23, 42, -7, 3

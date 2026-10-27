# control-sum_pointer.s -- The same sum with a pointer and the test at the bottom of the loop (n > 0 assumed).
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        la    a0, arr           # pointer to arr[0]
        li    a1, 8             # n
        slli  t2, a1, 2
        add   t2, a0, t2        # end: just past the last
        li    t1, 0             # sum
loop:   lw    t3, 0(a0)
        add   t1, t1, t3
        addi  a0, a0, 4         # next element
        bne   a0, t2, loop      # until the end
        mv    a0, t1
        li    a7, 93
        ecall
        .data
arr:    .word 4, 8, 15, 16, 23, 42, -7, 3

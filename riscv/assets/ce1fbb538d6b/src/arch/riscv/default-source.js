// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const DEFAULT_SOURCE = `# Sum of an array -- an example to start from.
        .data
nums:   .word 3, -1, 4, 1, -5, 9
n:      .word 6
msg:    .asciz "sum computed\\n"

        .text
_start: la    t0, nums        # pointer
        la    t1, n
        lw    t1, 0(t1)       # count
        li    a0, 0           # sum
loop:   beqz  t1, done
        lw    t2, 0(t0)
        add   a0, a0, t2
        addi  t0, t0, 4
        addi  t1, t1, -1
        j     loop
done:   mv    s0, a0
        li    a0, 1           # write(1, msg, 13)
        la    a1, msg
        li    a2, 13
        li    a7, 64
        ecall
        mv    a0, s0
        li    a7, 93          # exit(sum)
        ecall
`;

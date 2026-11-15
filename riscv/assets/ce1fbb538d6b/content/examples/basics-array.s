# basics-array.s -- Sum of a four-word array and the address of its largest element, without branches.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        la    s0, vals          # base address
        lw    a0, 0(s0)         # sum := vals[0]
        mv    a1, a0            # max := vals[0]
        mv    a2, s0            # its address
        lw    t0, 4(s0)         # element 1
        addi  t3, s0, 4         # its address: base + 4 * 1
        add   a0, a0, t0
        slt   t1, a1, t0        # 1 if it is larger
        neg   t1, t1            # mask: all ones or zero
        xor   t2, a1, t0
        and   t2, t2, t1
        xor   a1, a1, t2        # max := the larger
        xor   t2, a2, t3
        and   t2, t2, t1
        xor   a2, a2, t2        # address of max follows
        lw    t0, 8(s0)         # element 2
        addi  t3, s0, 8
        add   a0, a0, t0
        slt   t1, a1, t0
        neg   t1, t1
        xor   t2, a1, t0
        and   t2, t2, t1
        xor   a1, a1, t2
        xor   t2, a2, t3
        and   t2, t2, t1
        xor   a2, a2, t2
        lw    t0, 12(s0)        # element 3
        addi  t3, s0, 12
        add   a0, a0, t0
        slt   t1, a1, t0
        neg   t1, t1
        xor   t2, a1, t0
        and   t2, t2, t1
        xor   a1, a1, t2
        xor   t2, a2, t3
        and   t2, t2, t1
        xor   a2, a2, t2
        li    a7, 93            # exit code = the sum
        ecall
        .data
vals:   .word 15, -4, 230, 9

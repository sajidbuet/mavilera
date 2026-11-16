# basics-bitfield.s -- Read the field in bits 11:8 of a register value, and write 9 into the field in bits 7:4.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        li    s0, 0x0000A5C3    # the register value
        srli  t0, s0, 8         # bring bits 11:8 down to 3:0
        andi  t0, t0, 0xF       # keep four bits: the field
        li    t1, 0xF0          # mask of bits 7:4
        not   t1, t1            # inverted mask
        and   t2, s0, t1        # clear bits 7:4
        li    t3, 9
        slli  t3, t3, 4         # 9 moved to bits 7:4
        or    t2, t2, t3        # insert the new field
        mv    a0, t0
        li    a7, 93
        ecall

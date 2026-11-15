# basics-const.s -- Building 0x12345FFF from lui and addi.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        lui   t0, 0x12346       # t0 = 0x12346000
        addi  t0, t0, -1        # t0 = 0x12345FFF
        lui   t1, 0x12345       # the uncorrected attempt
        addi  t1, t1, -1        # t1 = 0x12344FFF, 4096 too small
        li    t2, 0x12345FFF    # the pseudo-instruction does the same as t0
        sub   a0, t0, t2        # 0 if t0 and t2 agree
        li    a7, 93
        ecall

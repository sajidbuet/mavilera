# basics-divshift.s -- -7 / 2 by div and by an arithmetic shift, and the results the M extension defines for division by zero and overflow.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        li    a0, -7
        li    a1, 2
        div   t0, a0, a1        # -3: division rounds towards zero
        rem   t1, a0, a1        # -1: remainder has the sign of the dividend
        srai  t2, a0, 1         # -4: shifting rounds towards minus infinity
        div   t3, a0, zero      # -1 (all ones): division by zero, no trap
        rem   t4, a0, zero      # -7: the dividend
        li    a2, -2147483648   # the most negative 32-bit integer
        li    a3, -1
        div   t5, a2, a3        # -2147483648: signed overflow, no trap
        rem   t6, a2, a3        # 0
        li    a0, 0
        li    a7, 93
        ecall

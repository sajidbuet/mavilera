# basics-expr.s -- y = (a - b) + (c ^ d) - e with a..e in a0..a4.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        li    a0, 20            # a
        li    a1, 7             # b
        li    a2, 12            # c
        li    a3, 10            # d
        li    a4, 3             # e
        sub   t0, a0, a1        # t0 = a - b
        xor   t1, a2, a3        # t1 = c ^ d
        add   t0, t0, t1        # t0 = (a - b) + (c ^ d)
        sub   a0, t0, a4        # y = t0 - e, returned as the exit code
        li    a7, 93
        ecall

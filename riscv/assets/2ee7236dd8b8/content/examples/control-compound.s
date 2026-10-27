# control-compound.s -- if (x > 0 and x < 100) count = count + 1, with short-circuit evaluation.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        li    a0, 42            # x
        li    s1, 0             # count
        blez  a0, skip          # x > 0 false: the second test is not made
        li    t0, 100
        bge   a0, t0, skip      # x < 100 false
        addi  s1, s1, 1         # both true
skip:   mv    a0, s1
        li    a7, 93
        ecall

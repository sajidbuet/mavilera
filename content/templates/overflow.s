# overflow.s -- Signed and unsigned, overflow and division by zero.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a RISC-VISTA template, written for the application).
#
# Try: step with the registers shown as Signed, then Unsigned, then Hex. The same
# 32 bits compare differently with slt and sltu. RISC-V does not trap on overflow
# or on division by zero: the results are defined, and the program carries on.
main:   li   t0, -1             # 0xFFFFFFFF
        li   t1, 1
        slt  a1, t0, t1         # 1: as signed numbers, -1 < 1
        sltu a2, t0, t1         # 0: as unsigned numbers, 0xFFFFFFFF > 1
        li   t2, 0x7FFFFFFF     # the largest signed value
        addi a3, t2, 1          # wraps to 0x80000000, the smallest
        div  a4, t1, zero       # division by zero: -1 (all bits set)
        rem  a5, t1, zero       # its remainder: the dividend, 1
        li   t3, 0x80000000
        li   t4, -1
        div  a6, t3, t4         # the one signed overflow of div: 0x80000000
        li   a0, 0
        li   a7, 93
        ecall

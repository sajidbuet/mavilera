# abi-fault.s -- Breaking the calling convention.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a RISC-VISTA template, written for the application).
#
# Try: Run (F5) and read the console: the calling-convention check reports that
# double returned with s0 changed. main kept 100 in s0 across the call and
# expected 114; it gets 28. Repair double by using a temporary register (t0)
# instead of s0, assemble again, and the report and the wrong result are gone.
main:   li   s0, 100            # kept in s0 across the call
        li   a0, 7
        call double
        add  a0, a0, s0         # expects 14 + 100 = 114
        li   a7, 93
        ecall

# double(a0) = 2 * a0 -- uses s0 as scratch without saving it: a fault
double: add  s0, a0, a0
        mv   a0, s0
        ret

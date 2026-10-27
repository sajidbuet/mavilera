# control-max3.s -- A non-leaf procedure that calls max twice.
# Exit code = max3(4, 31, 9).
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
_start: li    a0, 4
        li    a1, 31
        li    a2, 9
        call  max3
        li    a7, 93
        ecall

# max3(a, b, c) = max(max(a, b), c).
# Non-leaf: its own call overwrites ra, and c (in a2) must survive the first
# call, so ra and c are kept in the stack frame and in s0.
max3:   addi  sp, sp, -16       # prologue: 16 bytes
        sw    ra, 12(sp)
        sw    s0, 8(sp)         # callee-saved: save first
        mv    s0, a2            # keep c across the call
        call  max               # a0 = max(a, b)
        mv    a1, s0
        call  max               # a0 = max(a0, c)
        lw    s0, 8(sp)         # epilogue
        lw    ra, 12(sp)
        addi  sp, sp, 16
        ret

max:    bge   a0, a1, maxend
        mv    a0, a1
maxend: ret

# procedures.s -- Calls, returns and a stack frame.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# Try: Step (F10) into sumsq and watch the Call stack pane and sp. Step over
# (F11) on a call runs the whole procedure at once; Step out (Shift+F11) runs to
# the return. sumsq saves ra, because its own calls overwrite it, and s0, s1,
# because the caller may keep values there; square is a leaf and needs no frame.
main:   li   a0, 3
        li   a1, 4
        call sumsq              # a0 = 3*3 + 4*4 = 25
        li   a7, 93
        ecall                   # exit code 25

# sumsq(a0, a1) = a0*a0 + a1*a1
sumsq:  addi sp, sp, -16        # a frame of 16 bytes (sp stays 16-byte aligned)
        sw   ra, 12(sp)
        sw   s0, 8(sp)
        sw   s1, 4(sp)
        mv   s1, a1             # keep the second argument across the call
        call square
        mv   s0, a0             # a0*a0, kept across the next call
        mv   a0, s1
        call square
        add  a0, a0, s0
        lw   s1, 4(sp)
        lw   s0, 8(sp)
        lw   ra, 12(sp)
        addi sp, sp, 16
        ret

# square(a0) = a0 * a0
square: mul  a0, a0, a0
        ret

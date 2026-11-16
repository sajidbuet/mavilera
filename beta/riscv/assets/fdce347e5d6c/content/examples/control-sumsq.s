# control-sumsq.s -- A procedure with a loop and a call.
# Exit code = sumsq of {3, -1, 4, 1, 5}.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
_start: la    a0, data
        li    a1, 5
        call  sumsq
        li    a7, 93
        ecall

# square(x): leaf.
square: mul   a0, a0, a0
        ret

# sumsq(a, n): non-leaf; the pointer, the count and the sum must survive
# each call to square, so they live in s0, s1 and s2.
sumsq:  addi  sp, sp, -16
        sw    ra, 12(sp)
        sw    s0, 8(sp)
        sw    s1, 4(sp)
        sw    s2, 0(sp)
        mv    s0, a0            # pointer
        mv    s1, a1            # elements left
        li    s2, 0             # s
        beqz  s1, sqdone
sqloop: lw    a0, 0(s0)
        call  square
        add   s2, s2, a0
        addi  s0, s0, 4
        addi  s1, s1, -1
        bnez  s1, sqloop
sqdone: mv    a0, s2
        lw    s2, 0(sp)
        lw    s1, 4(sp)
        lw    s0, 8(sp)
        lw    ra, 12(sp)
        addi  sp, sp, 16
        ret
        .data
data:   .word 3, -1, 4, 1, 5

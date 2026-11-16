# tour.s -- A tour of Hazard3's extensions: Zca, Zba, Zbb, M and Zcmp in one short program.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# Try: Assemble, then Step (F10) through it and watch the Listing: c.addi is a 16-bit instruction
# (two bytes of address), cm.push saves two registers and moves sp in one instruction.
# At the end total holds 150, a3 the number of one bits of 150 (4) and a0 is 150 x 150.
# An ebreak ends the program while no trap handler is set.
        .text
_start: la      a0, table           # a0 <- the address of the table (auipc + addi)
        li      a1, 5               # five words
        li      a2, 0               # the sum
loop:   lw      t0, 0(a0)
        add     a2, a2, t0
        c.addi  a0, 4               # compressed (Zca): a 16-bit instruction
        addi    a1, a1, -1
        bnez    a1, loop
        la      t1, total
        sw      a2, 0(t1)           # total <- 150
        cpop    a3, a2              # Zbb: the number of one bits of the sum
        sh2add  a4, a1, t1          # Zba: t1 + a1 * 4
        call    square              # a0 <- a2 * a2
        ebreak

square: cm.push   {ra, s0}, -16     # Zcmp: save ra and s0, sp <- sp - 16
        mv        s0, a2
        mul       a0, s0, s0        # M: multiply
        cm.popret {ra, s0}, 16      # restore them, sp <- sp + 16, return

        .data
table:  .word   10, 20, 30, 40, 50
total:  .word   0

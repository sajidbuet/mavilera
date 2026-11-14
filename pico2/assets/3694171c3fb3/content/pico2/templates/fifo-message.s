# fifo-message.s -- A message through the FIFO: core 0 launches core 1, then the cores trade numbers.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# The SIO has a FIFO in each direction (4 words deep): FIFO_WR sends to the other core, FIFO_RD
# reads what it sent, FIFO_ST says VLD (a word waits) and RDY (there is room). Core 1 waits in the
# bootrom until core 0 sends 0, 0, 1, the trap vector, a stack pointer and an entry address, each
# echoed back (the launch handshake of the RP2350 datasheet, section 5.3). Then core 1 squares each
# number core 0 sends and sends the square back. a0 ends as 3*3 + 4*4 + 5*5 = 50.
# Try: step through "launch" and watch FIFO_ST and the Core 1 registers; then core 1's pc moves too.
        .text
_start: li      s0, 0xd0000000          # SIO
        la      s2, launch              # the six words of the handshake
        li      s1, 0                   # which of them
send:   slli    t0, s1, 2
        add     t0, s2, t0
        lw      t1, 0(t0)
        bnez    t1, push
drain:  lw      t2, 0x50(s0)            # FIFO_ST: before a 0, empty what core 1 sent
        andi    t2, t2, 1               # VLD
        beqz    t2, wake
        lw      t2, 0x58(s0)            # FIFO_RD
        j       drain
wake:   slt     zero, zero, ra          # h3.unblock: wake core 1 if it waits
push:   lw      t2, 0x50(s0)
        andi    t2, t2, 2               # RDY
        beqz    t2, push
        sw      t1, 0x54(s0)            # FIFO_WR
echo:   lw      t2, 0x50(s0)
        andi    t2, t2, 1
        beqz    t2, echo
        lw      t2, 0x58(s0)            # the echo
        bne     t2, t1, again           # not the word sent: start again
        addi    s1, s1, 1
        li      t3, 6
        blt     s1, t3, send
        li      a0, 0                   # core 1 runs: send 3, 4, 5 and add up the squares
        li      s3, 3
trade:  sw      s3, 0x54(s0)
reply:  lw      t2, 0x50(s0)
        andi    t2, t2, 1
        beqz    t2, reply
        lw      t2, 0x58(s0)
        add     a0, a0, t2
        addi    s3, s3, 1
        li      t3, 6
        blt     s3, t3, trade
        ebreak
again:  li      s1, 0
        j       send

# core 1: square each word from core 0 and send it back, for ever
core1:  li      s0, 0xd0000000
next:   lw      t2, 0x50(s0)
        andi    t2, t2, 1
        beqz    t2, next
        lw      t1, 0x58(s0)
        mul     t1, t1, t1
        sw      t1, 0x54(s0)
        j       next

        .data
launch: .word   0, 0, 1, 0, 0x20081000, core1   # trap vector 0 (core 1 takes no traps here), stack, entry

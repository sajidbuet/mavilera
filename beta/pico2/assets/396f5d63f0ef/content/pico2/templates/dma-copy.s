# dma-copy.s -- Copy memory with DMA: channel 0 moves sixteen words while the core counts.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# The DMA copies without the core: the program gives channel 0 a read address, a write address and
# a count, and the write to CTRL_TRIG starts it. One word moves each clock cycle (unpaced: TREQ_SEL
# 63). Meanwhile the core polls CTRL_TRIG's BUSY bit (26) and counts how often it looked; when the
# channel is done, the core adds up the copy. a0 ends as the sum, 136 (1 + 2 + ... + 16), and a1
# as the number of polls.
# Try: Assemble, then step to the write of CTRL_TRIG and on, one instruction at a time: watch
# CH0_TRANS_COUNT count down and CH0_WRITE_ADDR move in the DMA tab of the memory pane, and the
# words appear at dst in the memory view.
        .text
_start: li      t0, 0x40023000          # RESETS, clear alias
        li      t1, 0x4                 # bit 2: DMA
        sw      t1, 0(t0)
        li      t0, 0x40020000
done:   lw      t2, 8(t0)               # RESET_DONE
        and     t2, t2, t1
        beqz    t2, done
        li      s0, 0x50000000          # DMA channel 0
        la      t1, src
        sw      t1, 0x00(s0)            # CH0_READ_ADDR
        la      t1, dst
        sw      t1, 0x04(s0)            # CH0_WRITE_ADDR
        li      t1, 16
        sw      t1, 0x08(s0)            # CH0_TRANS_COUNT: sixteen transfers
        li      t1, 0x007e0059          # EN, words (DATA_SIZE 2), INCR_READ, INCR_WRITE,
        sw      t1, 0x0c(s0)            # CHAIN_TO 0 (itself: none), TREQ_SEL 63: the write starts it
        li      a1, 0                   # polls
        li      t2, 0x04000000          # BUSY (bit 26)
busy:   addi    a1, a1, 1
        lw      t1, 0x0c(s0)            # CH0_CTRL_TRIG
        and     t1, t1, t2
        bnez    t1, busy                # until the channel is done
        la      t0, dst
        li      t3, 16
        li      a0, 0
sum:    lw      t1, 0(t0)
        add     a0, a0, t1
        addi    t0, t0, 4
        addi    t3, t3, -1
        bnez    t3, sum
        ebreak

        .data
src:    .word   1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
dst:    .space  64

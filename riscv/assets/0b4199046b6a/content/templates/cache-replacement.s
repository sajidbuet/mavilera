# cache-replacement.s -- Replacement: LRU keeps the block that is used again.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a RISC-VISTA template, written for the application).
#
# A 2-way data cache with 16-byte blocks has 32 sets, so blocks 512 bytes
# apart share a set; A, B and C below all use set 0, which holds only two of
# them. Each round loads A, B, A, C. With LRU the block A, used twice in each
# round, is never the least recently used and always stays: 13 misses in the 24
# loads. With FIFO the oldest block goes, and A is the oldest of all: 18
# misses. Try: step through a round and watch which way is marked "next out";
# then choose FIFO for the data cache in the Memory setting and run again.
        .data
blkA:   .word 1
        .space 508
blkB:   .word 2
        .space 508
blkC:   .word 3
        .text
main:   la   t0, blkA
        la   t1, blkB
        la   t2, blkC
        li   s1, 6              # rounds
        li   a0, 0
round:  lw   t3, 0(t0)          # A
        add  a0, a0, t3
        lw   t3, 0(t1)          # B
        add  a0, a0, t3
        lw   t3, 0(t0)          # A again
        add  a0, a0, t3
        lw   t3, 0(t2)          # C
        add  a0, a0, t3
        addi s1, s1, -1
        bnez s1, round
        li   a7, 93
        ecall                   # exit code = 42
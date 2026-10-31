# exceptions.s -- every synchronous exception of the profile iss-priv, in M mode and in U mode, one handler.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: code (a test program for test/priv-conformance.test.mjs).
        .text
start:  la    t0, handler
        csrw  mtvec, t0
        li    s8, 0x20000        # the handler logs mcause and mtval here
        li    s11, 0
        ecall                    # 11: environment call from M
        ebreak                   # 3: breakpoint (mtval = pc)
        .word 0                  # 2: illegal instruction (mtval = the word)
        lui   t0, 0x10
        lw    a0, 1(t0)          # 4: load address misaligned (mtval = 0x10001)
        sw    a0, 2(t0)          # 6: store address misaligned
        csrw  mvendorid, zero    # 2: write to a read-only CSR
        csrr  a1, 0x7c0          # 2: no such CSR
        csrr  a2, mcycle
        csrr  a3, minstret
        csrr  a4, misa
        csrr  a5, mhartid
        csrr  a6, mstatus
        li    t1, 0x40000002
        lw    a7, 0(t1)          # 4: misaligned, in the peripheral window
        la    t1, odd
        addi  t1, t1, 2
        jr    t1                 # 0: instruction address misaligned (mtval = target)
odd:    nop
        # a protection region the U-mode program must not touch, then all of memory with every permission
        li    t0, 0xc1ff         # NAPOT, 4 KiB at 0x30000
        csrw  pmpaddr0, t0
        li    t0, 0x1fffffff     # NAPOT, the whole 32-bit space
        csrw  pmpaddr1, t0
        li    t0, 0x1f18         # entry 0: no permission; entry 1: R, W, X
        csrw  pmpcfg0, t0
        la    t0, user
        csrw  mepc, t0
        csrw  mstatus, zero      # MPP = U
        mret                     # to U mode
user:   li    t3, 0x30000
        lw    a0, 0(t3)          # 5: load access fault (PMP)
        sw    a0, 0(t3)          # 7: store access fault (PMP)
        csrr  a1, mcycle         # 2: any CSR from U mode
        mret                     # 2: mret from U mode
        ecall                    # 8: environment call from U
        li    t4, 0x20800
        sw    t4, 0(t4)          # allowed: the second entry
        halt
handler:
        csrr  t5, mcause
        csrr  s9, mtval
        sw    t5, 0(s8)
        sw    s9, 4(s8)
        addi  s8, s8, 8
        addi  s11, s11, 1
        csrr  t6, mepc
        addi  t6, t6, 4
        csrw  mepc, t6
        mret

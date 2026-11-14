# ecall-trap.s -- a system call is a trap: ecall enters the handler, mret returns.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a template written for the application).
#
# In this profile ecall does not stop the program or print: it raises an exception (mcause 11,
# "environment call from M-mode"). The handler at mtvec reads the call number from a7, does the work
# and returns. mepc holds the address of the ecall itself, so the handler adds 4 before mret, or the
# ecall would run again. Calls: 1 prints the character in a0 through the UART; 2 adds a0 and a1;
# any other number returns -1. Step through and watch mcause, mepc and the mode in the
# Peripherals tab; the UART terminal shows the text. Final: s1 = 42, s2 = -1, and "Hi" is printed.
        .text
main:   la    t0, handler
        csrw  mtvec, t0
        li    a7, 1             # call 1: print a character
        li    a0, 72            # 'H'
        ecall
        li    a7, 1
        li    a0, 105           # 'i'
        ecall
        li    a7, 2             # call 2: add
        li    a0, 20
        li    a1, 22
        ecall
        mv    s1, a0            # 42
        li    a7, 9             # no such call
        ecall
        mv    s2, a0            # -1
        halt
handler:
        csrr  t0, mcause
        li    t1, 11
        bne   t0, t1, other     # not an ecall from M mode
        csrr  t0, mepc
        addi  t0, t0, 4         # return to the instruction after the ecall
        csrw  mepc, t0
        li    t1, 1
        beq   a7, t1, putc
        li    t1, 2
        beq   a7, t1, add2
        li    a0, -1            # unknown call
        mret
putc:   li    t2, 0x40002000    # the UART
ready:  lw    t3, 8(t2)         # STATUS
        andi  t3, t3, 1         # bit 0: the transmitter is ready
        beqz  t3, ready
        sw    a0, 0(t2)         # TXDATA
        mret
add2:   add   a0, a0, a1
        mret
other:  halt                    # some other trap: stop

# recursion.s -- A recursive procedure: factorial.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# Try: set a breakpoint on the line base: and Run (F5). The Call stack pane then
# shows five nested calls of fact, each with its own frame on the stack; the
# Counters pane records the deepest stack use. Step on to see the calls return
# one by one, multiplying on the way back.
main:   li   a0, 5
        call fact
        li   a7, 93
        ecall                   # exit code 5! = 120

# fact(n) = 1 for n <= 1, else n * fact(n - 1)
fact:   li   t0, 1
        ble  a0, t0, base
        addi sp, sp, -16
        sw   ra, 12(sp)
        sw   a0, 8(sp)          # n is needed after the call
        addi a0, a0, -1
        call fact               # a0 = fact(n - 1)
        lw   t1, 8(sp)
        mul  a0, a0, t1
        lw   ra, 12(sp)
        addi sp, sp, 16
        ret
base:   li   a0, 1
        ret

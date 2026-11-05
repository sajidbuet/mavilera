# hello.s -- Hello, RISC-V: the write system call.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a RISC-VISTA template, written for the application).
#
# Try: Assemble (Ctrl+Enter), then Run (F5). The text appears in the console.
# Step (F10) instead and watch a0, a1, a2 and a7 being set up before each ecall.
        .data
msg:    .asciz "Hello, RISC-V!\n"
        .text
main:   li   a0, 1              # file descriptor 1: standard output
        la   a1, msg            # address of the first byte
        li   a2, 15             # number of bytes
        li   a7, 64             # system call 64: write
        ecall
        li   a0, 0              # exit code 0
        li   a7, 93             # system call 93: exit
        ecall

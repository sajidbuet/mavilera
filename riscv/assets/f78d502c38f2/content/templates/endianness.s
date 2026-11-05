# endianness.s -- Bytes, half-words and words in memory.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a MAVILERA template, written for the application).
#
# Try: switch the Memory pane to Bytes and find the word at the label word.
# RISC-V is little-endian: the least significant byte has the lowest address.
# Step and compare each load with the bytes, and watch sb change one byte only.
        .data
word:   .word 0x11223344
        .text
main:   la   t0, word
        lbu  a1, 0(t0)          # 0x44: the lowest address holds the least significant byte
        lbu  a2, 3(t0)          # 0x11
        lhu  a3, 0(t0)          # 0x3344
        li   t1, 0xAB
        sb   t1, 1(t0)          # the word becomes 0x1122AB44
        lw   a4, 0(t0)
        lb   a5, 1(t0)          # 0xFFFFFFAB: lb sign-extends; lbu would give 0xAB
        li   a0, 0
        li   a7, 93
        ecall

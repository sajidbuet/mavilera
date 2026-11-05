# cpu-gpu-abs.s -- CPU + GPU: the host runs a kernel on the GPU, y[i] = |x[i]| for eight threads.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (Apache-2.0). Written by tools/gpu/host-templates.mjs; do not edit by hand.
#
# The GPU is the GPU Laboratory's SIMT core (two warps of four lanes) at 0x5000_1000, with MAVILERA's register map:
# CTRL 0x000 (1 = start), STATUS 0x004 (bit 0 BUSY, bit 1 DONE, bit 2 FAULT), IMEM from 0x400, DMEM from 0x800.
# The host copies the kernel and x into the GPU, starts it, polls STATUS while the GPU issues one warp-instruction
# per clock cycle, and copies y back to its own memory. Step it in the GPU view to see both at work.
        .equ GPU,    0x50001000
        .equ STATUS, 0x004
        .equ IMEM,   0x50001400
        .equ DMEM,   0x50001800
        .equ N,      14           # kernel words
        .text
main:   li   s0, GPU
        la   t0, kernel        # copy the kernel into the GPU's instruction memory
        li   t1, IMEM
        li   t2, N
code:   lw   t3, 0(t0)
        sw   t3, 0(t1)
        addi t0, t0, 4
        addi t1, t1, 4
        addi t2, t2, -1
        bnez t2, code
        la   t0, x             # copy x into GPU data words 0 to 7
        li   t1, DMEM
        li   t2, 8
data:   lw   t3, 0(t0)
        sw   t3, 0(t1)
        addi t0, t0, 4
        addi t1, t1, 4
        addi t2, t2, -1
        bnez t2, data
        li   t3, 1             # CTRL: start
        sw   t3, 0(s0)
poll:   lw   t3, STATUS(s0)    # poll until BUSY is 0
        andi t3, t3, 1
        bnez t3, poll
        la   t0, y             # copy y back from GPU data words 8 to 15
        li   t1, DMEM + 32
        li   t2, 8
back:   lw   t3, 0(t1)
        sw   t3, 0(t0)
        addi t0, t0, 4
        addi t1, t1, 4
        addi t2, t2, -1
        bnez t2, back
        halt
        .data
kernel:                        # the kernel, assembled by the GPU Laboratory (source in the comments)
        .word  0x00200293   # li t0, 2
        .word  0x00000337   # la t1, kernel
        .word  0x01030313   # la t1, kernel
        .word  0x0062900b   # wspawn t0, t1
        .word  0xcc0022f3   # csrr t0, THREAD_INDEX
        .word  0x00229293   # slli t0, t0, 2
        .word  0x0002a303   # lw t1, 0(t0)
        .word  0x000323b3   # slt t2, t1, zero
        .word  0x0003a00b   # split t2
        .word  0x00038463   # beqz t2, 1f
        .word  0x40600333   # sub t1, zero, t1
        .word  0x0000300b   # join
        .word  0x0262a023   # sw t1, 32(t0)
        .word  0x0000000b   # tmc zero
x:      .word  5, -3, 0, -7, 2, -1, 4, -8
y:      .space 32

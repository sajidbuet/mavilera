# tests-isa_all.s -- Every RV32I and M instruction at least once, for the listing (it does not run to a halt).
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        .text
start:  lui    a0, 0x12345
        lui    t6, 0xfffff
        auipc  ra, 0
        auipc  s11, 0x80000
        jal    ra, fwd
        jal    zero, start
        jalr   ra, 0(a5)
        jalr   zero, -4(sp)
        jalr   t0, 2047(t1)
back:   beq    a0, a1, back
        bne    s0, s1, fwd
        blt    t0, t1, back
        bge    a2, a3, fwd
        bltu   x5, x31, back
        bgeu   x0, x1, fwd
        lb     a0, -1(sp)
        lh     a1, 2(s0)
        lw     a2, -2048(gp)
        lbu    a3, 2047(tp)
        lhu    a4, 0(a5)
        sb     a0, -1(sp)
        sh     a1, 2(s0)
        sw     a2, -2048(gp)
        addi   a0, a1, -2048
        slti   a0, a1, 2047
        sltiu  t0, t1, -1
        xori   s2, s3, 0x555
        ori    s4, s5, -1
        andi   s6, s7, 255
        slli   t3, t4, 0
        slli   t3, t4, 31
        srli   t5, t6, 1
        srai   a6, a7, 31
fwd:    add    s8, s9, s10
        sub    a0, zero, a0
        sll    t0, t0, t1
        slt    t1, t2, t3
        sltu   t4, t5, t6
        xor    a0, a1, a2
        srl    a3, a4, a5
        sra    a6, a7, s0
        or     s1, s2, s3
        and    s4, s5, s6
        mul    a0, a1, a2
        mulh   a3, a4, a5
        mulhsu a6, a7, t0
        mulhu  t1, t2, t3
        div    s0, s1, s2
        divu   s3, s4, s5
        rem    s6, s7, s8
        remu   s9, s10, s11
        fence  iorw, iorw
        fence  r, w
        fence.i
        ecall
        ebreak

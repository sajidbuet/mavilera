; flags.s -- Carry and overflow: the same bits, read unsigned and signed
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an ARMv7 template, written for the application).
;
; Try: after each S instruction, read N, Z, C and V in the CPSR group. For a subtraction
; C = 1 means "no borrow". The rotated constants (#0x80000000) are an instruction-level
; extension: the processor views take 8-bit constants only.
        MVN   R1, #0          ; R1 <- 0xFFFFFFFF (-1 signed, 4294967295 unsigned)
        ADDS  R0, R1, #1      ; 0, carry out: Z = 1, C = 1, V = 0
        MVN   R2, #0x80000000 ; R2 <- 0x7FFFFFFF, the largest signed number
        ADDS  R0, R2, #1      ; 0x80000000: no carry, but signed overflow: N = 1, V = 1
        MOV   R3, #0
        SUBS  R0, R3, #1      ; 0 - 1 = 0xFFFFFFFF: a borrow, so C = 0
        MOV   R4, #0x80000000
        CMP   R4, #1          ; 0x80000000 - 1 = 0x7FFFFFFF: C = 1, V = 1
        MOV   R5, #5
        SUBS  R0, R5, #5      ; 5 - 5 = 0: Z = 1 and C = 1
        ANDS  R0, R4, R4      ; a logical S instruction: N, Z set; C and V kept
done:   B     done            ; a branch to itself ends the run

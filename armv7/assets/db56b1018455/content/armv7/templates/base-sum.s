; base-sum.s -- The base processor's instructions only: add the numbers 1 to 10
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an ARMv7 template, written for the application).
;
; The base single-cycle processor runs ADD, SUB, AND, ORR, LDR, STR and B, each with a
; condition: no MOV and no CMP, so SUB R0, R0, R0 clears a register and SUBS sets the
; flags. Try: step through in the Single-cycle view and watch BGE take the path through
; the ALU to the PC until R1 passes 10. The run ends with 55 in R0 and at address 100.
        SUB   R0, R0, R0      ; R0 <- 0, the sum (instead of MOV R0, #0)
        ADD   R1, R0, #1      ; R1 <- 1, the next number
        ADD   R2, R0, #10     ; R2 <- 10, the last number
loop:   ADD   R0, R0, R1      ; sum <- sum + number
        ADD   R1, R1, #1      ; the next number
        SUBS  R3, R2, R1      ; flags of 10 - R1 (instead of CMP R1, #10)
        BGE   loop            ; again while R1 <= 10
        SUB   R4, R4, R4      ; R4 <- 0, the base address
        STR   R0, [R4, #100]  ; M[100] <- 55
done:   B     done            ; a branch to itself ends the run

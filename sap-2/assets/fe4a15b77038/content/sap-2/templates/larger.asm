; larger.asm -- The larger of two numbers, with the sign flag
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-2 template, written for the application).
;
; Try: change 45 and 60 and run again. SUB sets S to bit 7 of A - B; JM jumps when S = 1, that is when A < B.
        MVI A,2DH     ; A <- 45
        MVI B,3CH     ; B <- 60
        MOV C,A       ; C <- A, kept: SUB overwrites A
        SUB B         ; A <- A - B; S = 1 if bit 7 of the result is 1
        JM second     ; S = 1: B is the larger
        MOV A,C       ; S = 0: A is the larger, or they are equal
        JMP show
second: MOV A,B
show:   OUT 03H       ; display the larger: 3CH
        HLT
; For numbers from 0 to 127 the difference has the right sign. With larger numbers it can overflow (200 - 10 gives
; bit 7 = 1), and SAP-2 has no carry flag to tell.

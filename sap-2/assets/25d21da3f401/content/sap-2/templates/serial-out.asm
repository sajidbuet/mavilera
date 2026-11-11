; serial-out.asm -- Send a byte bit by bit on SERIAL OUT
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-2 template, written for the application).
;
; Try: step and watch port 4 in the Ports tab: SERIAL OUT (bit 0) gives the bits of B4H = 10110100, lowest first:
; 0, 0, 1, 0, 1, 1, 0, 1. RAR brings each bit to bit 0 in turn; ANI 01H keeps ACKNOWLEDGE (bit 7) off.
        MVI B,0B4H    ; B <- 10110100, the byte to send
        MVI C,08H     ; eight bits
next:   MOV A,B
        ANI 01H       ; A <- bit 0 of B
        OUT 04H       ; SERIAL OUT <- that bit
        MOV A,B
        RAR           ; rotate right: bit 0 into bit 7
        MOV B,A
        DCR C
        JNZ next
        MOV A,B       ; after eight rotations B holds the byte again
        OUT 03H       ; display B4H
        HLT

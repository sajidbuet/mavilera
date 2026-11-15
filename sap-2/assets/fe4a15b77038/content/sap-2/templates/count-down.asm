; count-down.asm -- Count down on the display
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-2 template, written for the application).
;
; Try: step and watch C and the Z flag; JNZ jumps back until DCR C makes C zero. The display shows 5, 4, 3, 2, 1.
        MVI C,05H     ; C <- 5, the count
loop:   MOV A,C       ; A <- C
        OUT 03H       ; port 3 <- A: the display, and a console line
        DCR C         ; C <- C - 1; Z = 1 when it reaches 0
        JNZ loop      ; again while Z = 0
        HLT           ; stop

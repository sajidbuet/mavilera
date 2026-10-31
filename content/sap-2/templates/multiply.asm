; multiply.asm -- Multiply by repeated addition
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-2 template, written for the application).
;
; Try: step through one pass of the loop, then run. 12 x 10 = 120 = 78H, in 35 instructions and 213 T states
; (the Counters pane): JNZ takes 10 T states when it jumps and 7 when it does not.
        MVI A,00H     ; A <- 0, the product
        MVI B,0CH     ; B <- 12, the multiplicand
        MVI C,0AH     ; C <- 10, the number of additions
again:  ADD B         ; A <- A + B
        DCR C         ; C <- C - 1; Z = 1 when C reaches 0 (A keeps its value)
        JNZ again     ; add again while C is not 0
        OUT 03H       ; port 3 <- A = 78H
        HLT
; With C = 0 at the start, DCR C makes FFH and the loop adds 256 times.

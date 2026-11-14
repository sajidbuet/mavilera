; rom-write.asm -- The read-only memory stops a store
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-2 template, written for the application).
;
; Try: run. 0000H to 07FFH hold the program, as the book's ROM holds its monitor, and are read-only; the RAM
; starts at 0800H. The display shows 2AH, then the STA into the ROM stops the run with an error.
        MVI A,2AH     ; A <- 42
        STA 2000H     ; M[2000H] <- A: RAM
        LDA 2000H     ; A <- M[2000H]
        OUT 03H       ; display 2AH
        STA 0010H     ; ROM: an error, and nothing is written
        HLT

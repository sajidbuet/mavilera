; alu-next-fetch.asm -- An ALU result written in the next fetch
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-2 template, written for the application).
;
; Try: in the Bus view, step one T state at a time (F10). ADD B puts B in TMP in its T4 and ends; its result reaches A
; in T2 of the next instruction, when the bus is idle: the controller shows it as pending until then. MOV C,A then
; copies the new A. The microprogram is the simulator's design, which keeps the book's 4 T states for ADD B.
        MVI A,23H     ; A <- 23H
        MVI B,11H     ; B <- 11H
        ADD B         ; T4: TMP <- B; A <- A + TMP in T2 of the next fetch
        MOV C,A       ; C <- 34H
        OUT 03H       ; display 34H
        HLT

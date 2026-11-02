; code-is-data.asm -- Code and data share one memory
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-1 template, written for the application).
;
; Try: LDA reads a byte of the program itself. The first instruction loads its own
; encoding (opcode 0000, address 0000 = 0); the second adds the byte of OUT (11100000).
        LDA 0         ; A <- M[0], the byte of this instruction
        ADD 2         ; A <- A + M[2], the byte of OUT below
        OUT           ; 224
        HLT

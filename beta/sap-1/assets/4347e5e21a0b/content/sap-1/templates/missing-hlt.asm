; missing-hlt.asm -- A program without HLT runs into its data
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-1 template, written for the application).
;
; Try: run it. Without HLT the program counter moves on to the data byte 30H, whose
; opcode 0011 is not an SAP-1 instruction, and the run stops with an error.
        LDA x
        OUT
x:      DB 30H

; timing-states.asm -- Fetch and execute, one timing state at a time
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-1 template, written for the application).
;
; Try: in the Bus view, step one clock at a time. T1 to T3 fetch every instruction (PC to
; MAR, PC + 1, RAM to IR); T4 to T6 depend on the opcode. LDA moves its operand in T4 and
; T5 and does nothing in T6; OUT needs only T4; HLT stops the clock in T4.
        LDA value
        OUT
        HLT

value:  DB 0A5H

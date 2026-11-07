; overlap.asm -- The BIU fetches while the EU executes
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an 8086 template, written for the application).
;
; Try: open the BIU and EU view, choose Clocks under Mode and open the Timeline tab. Short instructions take bytes
; faster than the bus interface unit fetches them, so the queue runs empty and the execution unit waits; MUL is long,
; so the queue fills and the bus goes idle (Ti); LODSW, PUSH and POP need the bus, and the execution unit may wait for
; a code fetch to finish; the taken LOOP empties the queue (E) and fetching starts again at "again". The clocks are
; the simulator's teaching model, not the 8086's. The total, 609, is left in DI and stored at "total".
        MOV  SI, OFFSET data    ; SI <- the table's offset
        MOV  CX, 3              ; three passes
        XOR  DI, DI             ; DI <- 0: the total
again:  LODSW                   ; AX <- the word at DS:SI (a memory read); SI <- SI + 2
        MOV  BX, AX             ; register moves of two bytes each
        MOV  DX, BX
        INC  DX                 ; one byte
        PUSH DX                 ; a memory write: the stack
        MOV  BX, 100            ; three bytes from the queue
        MUL  BX                 ; DX:AX <- AX x 100: a long instruction
        ADD  DI, AX             ; the total gains 100 x word
        POP  DX                 ; a memory read: the stack
        ADD  DI, DX             ; ... and word + 1
        LOOP again              ; CX <- CX - 1; again while CX is not 0
        MOV  total, DI          ; 102 + 203 + 304 = 609
        HLT

data    DW   1, 2, 3
total   DW   ?

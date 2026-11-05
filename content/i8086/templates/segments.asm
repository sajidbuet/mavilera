; segments.asm -- Segments and physical addresses
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an 8086 template, written for the application).
;
; Try: choose "8086 · segments set by the program" in the Architecture selector, where DS, ES and SS start at 0. The
; physical address is segment × 16 + offset: DS = 2000H and offset 0010H give 20010H; ES = 2001H and offset 0000H give
; the same byte. A BP-based address uses SS, others DS, unless an override such as ES: is written.
        MOV  AX, 2000H
        MOV  DS, AX             ; DS <- 2000H (a segment register is loaded from a register)
        MOV  AX, 2001H
        MOV  ES, AX             ; ES <- 2001H
        MOV  AX, 3000H
        MOV  SS, AX             ; the stack in segment 3000H
        MOV  SP, 0100H
        MOV  BYTE PTR [0010H], 41H   ; DS:0010H = 20010H <- 41H
        MOV  AL, ES:[0000H]     ; ES:0000H = 20010H: the same byte
        MOV  BP, SP
        PUSH AX                 ; SS:00FEH = 300FEH
        MOV  BL, [BP-2]         ; [BP] uses SS: the byte just pushed
        MOV  AX, CS
        MOV  DS, AX             ; DS <- CS: the program's own data again
        MOV  AL, BL
        OUT  0E9H, AL           ; prints A
        HLT

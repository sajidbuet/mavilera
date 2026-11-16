; interrupts.asm -- Install interrupt handlers: INT 80H and the divide error
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an 8086 template, written for the application).
;
; Try: the vector of type n is at 4 × n: its offset, then its segment. INT 80H pushes FLAGS, CS and IP and jumps to the
; handler; IRET returns. Dividing by 0 is a divide error, type 0: the 8086 pushes the address of the next instruction,
; so the handler here returns past the DIV. Watch SP and the call stack. The interrupts from outside the processor,
; NMI and INTR, come from the Interrupts panel: see the template "NMI and INTR from the Interrupts panel".
        XOR  AX, AX
        MOV  ES, AX             ; ES <- 0: the interrupt vector table
        MOV  WORD PTR ES:[4*80H], OFFSET say_hi
        MOV  ES:[4*80H+2], CS   ; vector 80H <- CS:say_hi
        MOV  WORD PTR ES:[0], OFFSET div_error
        MOV  ES:[2], CS         ; vector 0 <- CS:div_error
        INT  80H                ; prints H
        MOV  AX, 100
        MOV  BL, 0
        DIV  BL                 ; divide error: INT 0
        MOV  AL, '!'            ; the handler returns here
        OUT  0E9H, AL
        HLT

say_hi: MOV  AL, 'H'
        OUT  0E9H, AL
        IRET

div_error:
        MOV  AL, 'E'
        OUT  0E9H, AL
        IRET

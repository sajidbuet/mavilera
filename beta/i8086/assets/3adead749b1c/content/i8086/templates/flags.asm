; flags.asm -- Carry, overflow, sign and zero after additions
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an 8086 template, written for the application).
;
; Try: step and read the flags after each ADD. 7FH + 1 overflows as a signed byte (OF = 1) but not unsigned (CF = 0);
; 0FFH + 1 carries (CF = 1, ZF = 1) without overflow. ADC adds the carry into the high byte of a 16-bit sum.
; DAA corrects a packed BCD sum: 38H + 45H = 7DH becomes 83H.
        MOV  AL, 7FH
        ADD  AL, 1              ; 80H: OF = 1, SF = 1, CF = 0
        MOV  AL, 0FFH
        ADD  AL, 1              ; 00H: CF = 1, ZF = 1, OF = 0
        MOV  AX, 0FFF0H
        MOV  DX, 0
        ADD  AX, 20H            ; low word: CF = 1
        ADC  DX, 0              ; high word: DX <- DX + 0 + CF
        MOV  AL, 38H
        ADD  AL, 45H            ; 7DH
        DAA                     ; 83H: the decimal sum 38 + 45
        HLT

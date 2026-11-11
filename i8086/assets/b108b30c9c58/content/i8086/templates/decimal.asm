; decimal.asm -- Print a number in decimal with DIV and the stack
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an 8086 template, written for the application).
;
; Try: DIV BX divides DX:AX by 10: AX gets the quotient, DX the remainder (the last digit). The digits come out last
; first, so each is pushed on the stack and popped in the right order. Watch SP and the stack in the memory panel.
        MOV  AX, 51966          ; the number to print
        CALL print_dec
        MOV  AL, 13
        OUT  0E9H, AL
        MOV  AL, 10
        OUT  0E9H, AL
        HLT

; print AX in decimal on the console
print_dec:
        MOV  BX, 10
        XOR  CX, CX             ; CX counts the digits
divide: XOR  DX, DX             ; DX:AX is the dividend
        DIV  BX                 ; AX <- DX:AX / 10, DX <- remainder
        PUSH DX                 ; keep the digit
        INC  CX
        TEST AX, AX
        JNZ  divide             ; until the quotient is 0
show:   POP  AX
        ADD  AL, '0'            ; the digit as a character
        OUT  0E9H, AL
        LOOP show
        RET

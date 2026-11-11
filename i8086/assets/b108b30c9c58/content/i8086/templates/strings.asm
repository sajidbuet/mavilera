; strings.asm -- Copy and compare strings with REP MOVSB and REPE CMPSB
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an 8086 template, written for the application).
;
; Try: REP MOVSB copies CX bytes from DS:SI to ES:DI in one step (CLD: SI and DI count up). REPE CMPSB compares while
; the bytes are equal: ZF = 1 after it means all were the same. Change one letter of "copy" after the copy (in the
; memory panel) and step the compare again to see ZF and CX change.
        CLD                     ; DF <- 0: count up
        MOV  SI, OFFSET source
        MOV  DI, OFFSET copy
        MOV  CX, 8              ; the length of the string
        REP  MOVSB              ; copy CX bytes from DS:SI to ES:DI
        MOV  SI, OFFSET source
        MOV  DI, OFFSET copy
        MOV  CX, 8
        REPE CMPSB              ; compare while equal
        MOV  SI, OFFSET same
        JE   say
        MOV  SI, OFFSET differ
say:    LODSB
        CMP  AL, 0
        JE   done
        OUT  0E9H, AL
        JMP  say
done:   HLT

source  DB   '8086 lab'
copy    DB   8 DUP (?)
same    DB   'The copy is the same.', 13, 10, 0
differ  DB   'The copy differs.', 13, 10, 0

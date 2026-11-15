; wrap-around.asm -- Subtract past zero: eight-bit numbers wrap around
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-1 template, written for the application).
;
; Try: 3 - 5 gives 254 (11111110), which is -2 in two's complement; SAP-1 has no flags
; to say that the result went below zero. Then 254 + 10 wraps past 255 to 8.
        LDA three
        SUB five
        OUT           ; 254
        ADD ten
        OUT           ; 8
        HLT

        ORG 0DH
three:  DB 3
five:   DB 5
ten:    DB 10

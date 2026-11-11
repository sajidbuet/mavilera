; sum-three.asm -- Add three numbers and show the sum
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-1 template, written for the application).
;
; Try: step and watch A after each instruction; the result is 12 + 9 + 30 = 51.
        LDA x         ; A <- M[x]
        ADD y         ; B <- M[y], A <- A + B
        ADD z
        OUT           ; the display shows A
        HLT

        ORG 0DH
x:      DB 12
y:      DB 9
z:      DB 30

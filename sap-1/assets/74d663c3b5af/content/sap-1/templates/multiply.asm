; multiply.asm -- Multiply by repeated addition, without a loop
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-1 template, written for the application).
;
; Try: SAP-1 has no jumps, so 7 x 4 is four additions written out; the sixteen bytes of
; memory limit how far this goes. Count the instructions and the timing states.
        LDA seven
        ADD seven
        ADD seven
        ADD seven
        OUT           ; 28
        HLT

        ORG 0FH
seven:  DB 7

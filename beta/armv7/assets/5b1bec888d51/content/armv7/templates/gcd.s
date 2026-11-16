; gcd.s -- Conditional execution: the greatest common divisor without a branch per case
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an ARMv7 template, written for the application).
;
; Try: step through and watch the listing grey out SUBGT or SUBLT when its condition
; fails. The run ends with 6 in R0 and in R1.
        MOV   R0, #48         ; a
        MOV   R1, #18         ; b
gcd:    CMP   R0, R1          ; flags of a - b
        SUBGT R0, R0, R1      ; a > b: a <- a - b
        SUBLT R1, R1, R0      ; a < b: b <- b - a
        BNE   gcd             ; until a = b
done:   B     done            ; a branch to itself ends the run

; factorial.s -- A recursive function: BL, PUSH and POP
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an ARMv7 template, written for the application).
;
; Try: open the call stack and step into fact; step over a BL; step out of a call.
; fact(n) returns n! in R0; there is no MUL in this subset, so it multiplies by repeated
; addition. The run ends with 120 in R4 and SP back where it started.
        MOV   R0, #5
        BL    fact            ; R0 <- 5!
        MOV   R4, R0
done:   B     done            ; a branch to itself ends the run

fact:   PUSH  {R4, LR}        ; keep R4 and the return address
        MOV   R4, R0          ; R4 <- n
        CMP   R0, #1
        MOVLE R0, #1          ; n <= 1: the result is 1
        BLE   ret
        SUB   R0, R0, #1
        BL    fact            ; R0 <- (n - 1)!
        MOV   R1, R0
        MOV   R0, #0
mul:    ADD   R0, R0, R1      ; R0 <- n x (n - 1)!, one addition at a time
        SUBS  R4, R4, #1
        BNE   mul
ret:    POP   {R4, PC}        ; restore R4 and return

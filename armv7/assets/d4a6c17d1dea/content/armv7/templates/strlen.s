; strlen.s -- Bytes and post-indexed addressing: the length of a string
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an ARMv7 template, written for the application).
;
; Try: LDRB R2, [R1], #1 loads a byte and then adds 1 to R1 (post-indexing, an
; instruction-level form). The run ends with 5 in R0, the length of "hello".
        MOV   R1, #0x10000    ; the address of text (.data starts at 0x10000)
        MOV   R0, #0          ; the count
next:   LDRB  R2, [R1], #1    ; R2 <- the byte at R1; then R1 <- R1 + 1
        CMP   R2, #0          ; the zero byte ends the string
        ADDNE R0, R0, #1
        BNE   next
done:   B     done            ; a branch to itself ends the run

        .data
text:   .asciz "hello"

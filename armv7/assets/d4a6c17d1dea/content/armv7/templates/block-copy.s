; block-copy.s -- LDM and STM: four words in two instructions
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an ARMv7 template, written for the application).
;
; Try: one step of LDM writes four registers and R0; one step of STM writes four
; memory words and R1. Step back undoes each at once.
        MOV   R0, #0x10000    ; source: words
        ADD   R1, R0, #16     ; destination: the four words after them
        LDM   R0!, {R2-R5}    ; R2..R5 <- the four words; R0 <- R0 + 16
        STM   R1!, {R2-R5}    ; the four words <- R2..R5; R1 <- R1 + 16
done:   B     done            ; a branch to itself ends the run

        .data
words:  .word 10, 20, 30, 40

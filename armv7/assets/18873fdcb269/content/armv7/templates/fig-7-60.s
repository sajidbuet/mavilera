; fig-7-60.s -- The processor test program of Harris and Harris, Fig. 7.60
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an ARMv7 template, written for the application).
;
; The instruction sequence and machine code of the test program in Harris and Harris,
; Digital Design and Computer Architecture: ARM Edition (2015), Fig. 7.60, p. 453; the
; comments are this application's. Every instruction is in the base processor's set.
; Try: the run stores 7 at address 96 and again at 100, and nothing else; watch which
; branches are taken and that ADD R15 skips one instruction.
MAIN    SUB  R0, R15, R15     ; R15 - R15 = 0, whatever R15 reads as
        ADD  R2, R0, #5
        ADD  R3, R0, #12
        SUB  R7, R3, #9
        ORR  R4, R7, R2
        AND  R5, R3, R4
        ADD  R5, R5, R4
        SUBS R8, R5, R7       ; sets the flags: not zero
        BEQ  END              ; so this branch is not taken
        SUBS R8, R3, R4       ; positive: N = V
        BGE  AROUND           ; taken
        ADD  R5, R0, #0       ; skipped
AROUND  SUBS R8, R7, R2       ; negative: N = 1, V = 0
        ADDLT R7, R5, #1      ; LT holds, so this one executes
        SUB  R7, R7, R2
        STR  R7, [R3, #84]    ; the first store
        LDR  R2, [R0, #96]    ; reads it back
        ADD  R15, R15, R0     ; R15 reads as this address + 8: skips one
        ADD  R2, R0, #14      ; skipped
        B    END
        ADD  R2, R0, #13      ; skipped
        ADD  R2, R0, #10      ; skipped
END     STR  R2, [R0, #100]   ; the second store
DONE    B    DONE             ; a branch to itself ends the run (added for the simulator)

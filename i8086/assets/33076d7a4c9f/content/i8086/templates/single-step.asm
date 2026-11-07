; single-step.asm -- The trap flag: a type 1 interrupt after every instruction
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an 8086 template, written for the application).
;
; Try: TF (bit 8 of FLAGS) has no instruction of its own: the program sets it with PUSHF, OR and POPF. An instruction
; that starts with TF = 1 is followed by a type 1 interrupt, so POPF itself is not, and the instructions after it
; are. The handler runs with TF = 0 (the entry clears it; IRET restores it) and counts the traps in BX. The last POPF
; clears TF, but it started with TF = 1, so one more trap follows it. BX ends at 12: MOV, three DEC and JNZ pairs,
; and PUSHF, POP, AND, PUSH, POPF. Watch the Interrupts tab ("Next: the single-step entry") while stepping.
        XOR  AX, AX
        MOV  ES, AX             ; ES <- 0: the interrupt vector table
        MOV  WORD PTR ES:[4*1], OFFSET on_step
        MOV  ES:[4*1+2], CS     ; type 1 (single-step) <- CS:on_step
        XOR  BX, BX             ; BX counts the traps
        PUSHF
        POP  AX
        OR   AX, 0100H          ; TF
        PUSH AX
        POPF                    ; TF <- 1 (no trap after POPF itself)
        MOV  CX, 3
again:  DEC  CX
        JNZ  again
        PUSHF
        POP  AX
        AND  AX, 0FEFFH         ; TF off
        PUSH AX
        POPF                    ; TF <- 0 (a trap still follows: TF was 1 when POPF started)
        MOV  traps, BX          ; 12
        HLT

on_step:
        INC  BX                 ; one more trap
        IRET

traps   DW   0

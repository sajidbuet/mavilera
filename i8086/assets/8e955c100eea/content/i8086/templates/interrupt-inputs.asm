; interrupt-inputs.asm -- NMI and INTR from the Interrupts panel
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an 8086 template, written for the application).
;
; Try: run; the program prints > and halts at HLT. Open the Interrupts tab of the memory pane and press NMI: the
; processor wakes, the NMI handler (type 2) prints N and returns past the HLT, and the loop halts again. Turn INTR on
; with type 20H: IF is 1, so the type 20H handler prints I. INTR is a level, not latched: while it stays on, the
; handler runs again after each IRET (and the one instruction IRET lets through), so turn it off again. With Delay,
; an input arrives some instructions later (each repetition of a string instruction counts as one): reset, give NMI
; with a delay of 14, and it arrives after the second repetition of REP MOVSB, which resumes after the handler at its
; REP prefix with CX = 3.
        XOR  AX, AX
        MOV  ES, AX             ; ES <- 0: the interrupt vector table
        MOV  WORD PTR ES:[4*2], OFFSET on_nmi
        MOV  ES:[4*2+2], CS     ; type 2 (NMI) <- CS:on_nmi
        MOV  WORD PTR ES:[4*20H], OFFSET on_intr
        MOV  ES:[4*20H+2], CS   ; type 20H <- CS:on_intr
        PUSH CS
        POP  ES                 ; ES <- CS for the copy (no interrupt until after the next instruction)
        MOV  SI, OFFSET text
        MOV  DI, OFFSET copy
        MOV  CX, 5
        CLD
        REP  MOVSB              ; NMI and INTR are accepted between two repetitions
        STI                     ; IF <- 1: INTR is taken from after the next instruction
        MOV  AL, '>'
        OUT  0E9H, AL
idle:   HLT                     ; wait for an interrupt
        JMP  idle

on_nmi: PUSH AX
        MOV  AL, 'N'
        OUT  0E9H, AL
        INC  nmis               ; count them
        POP  AX
        IRET

on_intr:
        PUSH AX
        MOV  AL, 'I'
        OUT  0E9H, AL
        POP  AX
        IRET

text    DB   'HELLO'
copy    DB   5 DUP (0)
nmis    DW   0

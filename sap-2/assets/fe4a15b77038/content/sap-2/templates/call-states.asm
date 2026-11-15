; call-states.asm -- CALL and RET, T state by T state
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-2 template, written for the application).
;
; Try: in the Bus view, step through the CALL's 18 T states. T6 and T9 read the address into TMP and TMP2; T10 to
; T15 write the return address to FFFEH and FFFFH through MAR and MDR (watch the memory window); T16 and T17 load the
; PC. RET reads the return address back in its T4 to T8.
        MVI A,09H
        CALL show     ; 18 T states
        HLT
show:   OUT 03H       ; display 09H
        RET           ; 10 T states

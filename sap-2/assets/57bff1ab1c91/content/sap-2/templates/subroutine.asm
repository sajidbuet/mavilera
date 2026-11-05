; subroutine.asm -- A subroutine called twice
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-2 template, written for the application).
;
; Try: step into the CALL, then look at FFFEH and FFFFH in the memory pane, and at the Call stack pane; step over
; the second CALL (F11). The display shows 0EH, then 1CH.
        MVI A,07H     ; A <- 7
        CALL double   ; M[FFFEH] <- 05H, M[FFFFH] <- 00H: the return address 0005H; PC <- double
        OUT 03H       ; display 14 = 0EH
        CALL double   ; return address 000AH
        OUT 03H       ; display 28 = 1CH
        HLT
double: MOV B,A       ; B <- A
        ADD B         ; A <- A + B
        RET           ; PC <- the return address at FFFEH and FFFFH
; SAP-2 keeps one return address: a CALL inside double would overwrite it, and the first RET would not come back here.

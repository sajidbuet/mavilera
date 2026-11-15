; keyboard.asm -- Add three keys from the keyboard
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an SAP-2 template, written for the application).
;
; Try: run, then press three keys in the Ports tab of the memory pane (or press a key, then step). The book's
; handshake: a key puts its byte on port 1 and sets READY (port 2, bit 0); the program reads port 1, then sets
; ACKNOWLEDGE (port 4, bit 7), which resets READY. The display shows the sum of the three keys.
        MVI B,00H     ; B <- 0, the sum
        MVI C,03H     ; C <- 3, the keys still to read
wait:   IN 02H        ; A <- port 2
        ANI 01H       ; keep READY; Z = 1 while no key is waiting
        JZ wait       ; no key yet: read port 2 again
        IN 01H        ; A <- the key's byte
        ADD B         ; A <- A + B
        MOV B,A       ; B <- the sum so far
        MVI A,80H     ; ACKNOWLEDGE (port 4, bit 7) ...
        OUT 04H       ; ... resets READY
        MVI A,00H
        OUT 04H       ; ACKNOWLEDGE off again
        DCR C         ; one key fewer to read
        JNZ wait
        MOV A,B
        OUT 03H       ; display the sum
        HLT

; sum-table.asm -- Add the words of a table
; Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
; Rights class: content (an 8086 template, written for the application).
;
; Try: step with F10 and watch SI move by 2 and CX count down; the sum is stored at "total". LOOP decrements CX and
; jumps while CX is not 0. OUT 0E9H, AL writes a character to the console (the simulator's convention).
        MOV  SI, OFFSET table   ; SI <- the table's offset
        MOV  CX, 5              ; five words
        XOR  AX, AX             ; AX <- 0 (and CF <- 0)
next:   ADD  AX, [SI]           ; AX <- AX + the word at DS:SI
        ADD  SI, 2              ; the next word
        LOOP next               ; CX <- CX - 1; again while CX is not 0
        MOV  total, AX          ; store the sum
        CMP  AX, 150            ; 10 + 20 + 30 + 40 + 50
        JNE  done
        MOV  SI, OFFSET msg
print:  LODSB                   ; AL <- the byte at DS:SI; SI <- SI + 1
        CMP  AL, 0
        JE   done
        OUT  0E9H, AL           ; the console
        JMP  print
done:   HLT

table   DW   10, 20, 30, 40, 50
total   DW   ?
msg     DB   'Sum OK', 13, 10, 0

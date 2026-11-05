# tests-abi_bad.s -- Deliberate calling-convention faults, as the ABI check reports them.
#   1. bad_s0 returns with s0 changed (callee-saved register not saved);
#   2. leaf is called with sp not 16-byte aligned;
#   3. bad_sp returns with sp changed (frame not released).
# good saves and restores s1 correctly and must not be reported.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
        .text
_start: li    s0, 111
        li    s1, 222
        call  bad_s0
        addi  sp, sp, -8         # misalign the stack ...
        call  leaf               # ... and call: violation 2
        addi  sp, sp, 8
        call  bad_sp
        addi  sp, sp, 16         # repair after bad_sp's fault
        call  good
        li    a0, 0
        li    a7, 93
        ecall

bad_s0: li    s0, 5              # violation 1: s0 not saved
        ret

leaf:   ret

bad_sp: addi  sp, sp, -16        # violation 3: sp not restored
        ret

good:   addi  sp, sp, -16
        sw    s1, 12(sp)
        li    s1, 9
        lw    s1, 12(sp)
        addi  sp, sp, 16
        ret

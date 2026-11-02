# bit-fields.s -- Packing and unpacking bit fields with shifts and masks.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (a RISC-VISTA template, written for the application).
#
# A date in 16 bits: day in bits 4:0, month in bits 8:5, year - 2000 in bits 15:9.
# Try: show the registers in binary (the format menu of the Registers pane) and
# step: watch each field move into place, then come out again. Select an
# instruction in the listing to see its own fields in the instruction inspector.
main:   li   t0, 27             # day
        li   t1, 10             # month
        li   t2, 26             # year 2026
        slli t1, t1, 5          # month to bits 8:5
        slli t2, t2, 9          # year to bits 15:9
        or   a0, t0, t1
        or   a0, a0, t2         # a0 = 0x355B, the packed date
        srli s1, a0, 5
        andi s1, s1, 0xF        # month again: shift down, then mask four bits
        srli s2, a0, 9          # year again: the top field needs no mask
        andi s3, a0, 0x1F       # day again: mask five bits
        li   a7, 93
        ecall

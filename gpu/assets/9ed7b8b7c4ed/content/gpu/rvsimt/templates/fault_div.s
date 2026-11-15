# fault_div.s -- RISC-V SIMT laboratory program: fault: a divergent branch.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (Apache-2.0); provenance of fault_div/prog.s and data.hex: test/fixtures/gpu/lab/README.md.
# Written by tools/gpu/lab-templates.mjs; do not edit by hand.
#
# A conditional branch whose outcome differs among the active threads: the core stops with fault 1.
# Profile: two warps of four lanes. The data section is the data memory from
# address 0: the argument block (kernel_args = 0) and the arrays.
    .include "simt.inc"
    .text
    .globl _start
_start:
    csrr   t0, LANE_ID
    andi   t0, t0, 1          # 1 in odd lanes
    beqz   t0, 1f             # divergent: must fault here
    li     t1, 99
    sw     t1, 0(zero)        # never reached
1:  tmc    zero

        .data                   # the data memory, from address 0 (data.hex)

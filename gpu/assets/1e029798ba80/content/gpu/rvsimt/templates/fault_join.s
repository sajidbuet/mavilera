# fault_join.s -- RISC-V SIMT laboratory program: fault: join on an empty stack.
# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: content (Apache-2.0); provenance of fault_join/prog.s and data.hex: test/fixtures/gpu/lab/README.md.
# Written by tools/gpu/lab-templates.mjs; do not edit by hand.
#
# A join with nothing on the reconvergence stack: the core stops with fault 4.
# Profile: two warps of four lanes. The data section is the data memory from
# address 0: the argument block (kernel_args = 0) and the arrays.
    .include "simt.inc"
    .text
    .globl _start
_start:
    li     t0, 1
    split  t0                 # uniform: pushes one reconverge entry
    join                      # pops it
    join                      # the stack is empty: must fault here
    li     t1, 99
    sw     t1, 0(zero)        # never reached
    tmc    zero

        .data                   # the data memory, from address 0 (data.hex)

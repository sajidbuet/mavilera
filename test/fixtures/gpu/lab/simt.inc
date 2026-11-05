# simt.inc -- the warp-control instructions and identity CSRs of the
# Chapter 11A RISC-V SIMT subset, for GNU as (-march=rv32i_zicsr).
# Warp control is on the custom-0 major opcode (0001011 = 0x0b), R-type,
# funct7 = 0; funct3 selects the operation. Copyright (c) 2026 Sajid
# Muhaimin Choudhury. All rights reserved.

.equ LANES,        4        # lanes per warp of the laboratory core

.equ THREAD_INDEX, 0xCC0    # warp * LANES + lane: index in the block
.equ LANE_ID,      0xCC1    # lane number within the warp
.equ WARP_ID,      0xCC2    # warp number
.equ BLOCK_INDEX,  0xCC3    # block index, set at launch
.equ BLOCK_SIZE,   0xCC4    # WARPS * LANES
.equ KERNEL_ARGS,  0xCC5    # argument pointer, set at launch

.macro tmc rs1              # active mask := rs1 (lowest active thread)
    .insn r 0x0b, 0, 0, x0, \rs1, x0
.endm
.macro wspawn rs1, rs2      # start warps 1 .. rs1-1 at address rs2
    .insn r 0x0b, 1, 0, x0, \rs1, \rs2
.endm
.macro split rs1            # divide the warp on bit 0 of rs1
    .insn r 0x0b, 2, 0, x0, \rs1, x0
.endm
.macro join                 # pop the reconvergence stack
    .insn r 0x0b, 3, 0, x0, x0, x0
.endm
.macro bar rs1, rs2         # wait at barrier rs1 for rs2 warps
    .insn r 0x0b, 4, 0, x0, \rs1, \rs2
.endm

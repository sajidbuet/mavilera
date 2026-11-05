// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { deviceDatapath } from './npu-datapath.js';
import { GPU_BASE } from '../../mem/gpu.js';
export const GPU_DP = deviceDatapath({ id: 'gpu', base: GPU_BASE, sel: 'sel_gpu', rdata: 'gpu_rdata', label: 'GPU\n0x5000_1000',
 alt: 'Extended by the simulator: the GPU (a SIMT core of two warps of four lanes) on the data bus beside the data memory (address from the ALU, write data from rs2), and a read-data multiplexer, selected by sel_ram, between the data memory and the result multiplexer.' });

// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const hex = (v, d = 1) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(d, '0')}`;
export const FAULT_NAMES = Object.freeze({
 1: 'divergent branch', 2: 'illegal instruction', 3: 'reconvergence stack overflow', 4: 'join on an empty stack',
 5: 'tmc with a non-empty stack', 6: 'warp-control operand error', 7: 'bad data address',
});
const FAULT_WHY = Object.freeze({
 1: 'the active threads of the warp disagree on a conditional branch; this core runs divergent code only between split and join',
 2: 'the word is not in the core\'s subset (RV32I without auipc, jalr, byte and half-word loads and stores, fence, ecall and ebreak; csrr only on the identity CSRs; the five warp-control instructions)',
 3: 'the reconvergence stack holds four entries per warp (two nested splits)',
 4: 'join found nothing on the reconvergence stack to return to',
 5: 'tmc changes the mask only while the reconvergence stack is empty',
 6: 'wspawn runs in warp 0 only, with no other warp active and at most WARPS warps; bar takes barrier 0 or 1 and 1 to WARPS warps',
 7: 'a load or store of an active thread is not word-aligned or lies outside the 256-word data memory',
});
export const RVSIMT_STRINGS = Object.freeze({
 variantLabel: 'RISC-V SIMT',
 appFull: 'GPU Laboratory',
 aboutText: 'MAVILERA is an educational platform for exploring microprocessor architecture. This module, the GPU Laboratory, '
 + 'runs a RISC-V SIMT core: warps of threads share one instruction fetch, each thread runs RV32I with its own registers, '
 + 'and an active mask with a reconvergence stack per warp lets the threads of a warp take different paths through split '
 + 'and join. A micro-ISA core of seven instructions is offered as an introduction.',
 viewIsa: 'Instructions',
 profileNames: Object.freeze({ lab: 'RISC-V SIMT · 2 warps × 4 lanes', 'lab-l8': 'RISC-V SIMT · 1 warp × 8 lanes' }),
 registerGroup: 'Core',
 warpGroup: (w) => `Warp ${w}`,
 threadGroup: (w, l) => `Warp ${w} lane ${l}`,
 engine: Object.freeze({
 fault: (code, pc, w) => `Fault ${code} (${FAULT_NAMES[code]}) at ${hex(pc, 8)} in warp ${w}: ${FAULT_WHY[code]}. `
 + 'The instruction is counted in cycles, issued and active_slots, as the laboratory\'s golden files count it; nothing else changed.',
 deadlock: 'Every running warp waits at a barrier that no other warp will reach: the core would wait for ever. '
 + 'The laboratory core does not stop by itself here; MAVILERA stops before the cycle.',
 done: (cycles, issued, active, lanes) => `Done: every warp has ended. ${cycles} cycles, ${issued} warp-instructions issued, `
 + `${active} active lane-slots; SIMT efficiency ${issued ? (100 * active / (issued * lanes)).toFixed(1) : '–'} %.\n`,
 }),
 asm: Object.freeze({
 outside: (text) => `${text} is outside the SIMT core's subset: the core faults on it (illegal instruction).`,
 outsideNote: 'Per thread: RV32I without auipc, jalr, byte and half-word loads and stores, fence, ecall and ebreak; csrr on the '
 + 'identity CSRs (thread_index, lane_id, warp_id, block_index, block_size, kernel_args); tmc, wspawn, split, join, bar.',
 }),
 counterNames: Object.freeze({
 cycles: 'Cycles',
 issued: 'Warp-instructions issued',
 active: 'Active lane-slots',
 idle: 'Idle lane-slots',
 efficiency: 'SIMT efficiency',
 percent: (a, all) => (all ? `${(100 * a / all).toFixed(1)} %` : '–'),
 }),
 capability: Object.freeze({
 cRiscvOnly: 'The C compiler targets the RISC-V module; the SIMT core is programmed in assembly.',
 noCalls: 'The SIMT subset has no jalr, so no call returns.',
 noMemorySystem: 'The SIMT core has its own instruction and data memories, without timing model, caches or devices.',
 oneProcessor: 'The GPU module has one core; there is nothing to compare.',
 notYet: 'Not yet available for the RISC-V SIMT core.',
 }),
 editorHelp: Object.freeze({
 tmc: { usage: 'tmc rs1', operation: 'active mask ← rs1 of the lowest active thread; 0 ends the warp (stack must be empty)' },
 wspawn: { usage: 'wspawn rs1, rs2', operation: 'warp 0: start warps 1 … rs1 − 1 at address rs2, all threads active, registers 0' },
 split: { usage: 'split rs1', operation: 'push reconverge {mask}; if bit 0 of rs1 divides the threads, push else {mask ∧ ¬p, PC + 4} and continue with mask ∧ p' },
 join: { usage: 'join', operation: 'pop: an else entry sets mask and PC; a reconverge entry restores the mask' },
 bar: { usage: 'bar rs1, rs2', operation: 'wait at barrier rs1 until rs2 warps have reached it' },
 }),
 customFormat: 'R-type on custom-0 (opcode 0001011), funct7 0; funct3 tmc 0, wspawn 1, split 2, join 3, bar 4',
 registerHelp: Object.freeze({
 pc: 'The PC of the warp that issues next (round-robin over the ready warps)',
 }),
 warpState: Object.freeze({ 0: 'not running', 1: 'ready', 2: 'waiting at bar' }),
 viewCore: 'Core · 2 × 4',
 viewCore8: 'Core · 1 × 8',
 core: Object.freeze({
 title: (warps, lanes) => `SIMT core · ${warps} warp${warps === 1 ? '' : 's'} × ${lanes} lanes`,
 label: (warps, lanes) => `SIMT core (${warps} × ${lanes})`,
 infoTitle: 'Issue details',
 diagramTitle: 'The SIMT core',
 description: (lanes) => `Block diagram of the SIMT core with ${lanes} lanes. The warp scheduler holds a PC per warp and chooses `
 + 'the next ready warp round-robin; its PC fetches one instruction, which one decoder broadcasts to every lane. Each lane '
 + 'holds its threads\' registers and an ALU; its writes pass a gate driven by the lane\'s bit of the active mask, on the way to '
 + 'the registers and the shared data memory. warp_ctrl holds each warp\'s mask and reconvergence stack; branch outcomes and '
 + 'predicates go back to it, and it tells the scheduler when a warp ends or a join redirects it. Counters record cycles, '
 + 'issued warp-instructions and active lane-slots. warp_ctrl and the write gates are highlighted. ',
 studentNote: 'Highlighted: warp_ctrl and the write gates, shown by what they do (masks, stack entries, the PC a join returns to), '
 + 'not by their logic.',
 noProgram: 'Assemble a program to run it on the core.',
 nothing: 'No warp is ready: the run is over.',
 coming: (cycle, w, pc, code, mask) => `Cycle ${cycle + 1}: warp ${w} issues ${code} at ${pc} with mask ${mask} (lane 0 first).`,
 ended: (cycles) => `Every warp has ended after ${cycles} cycles.`,
 faulted: (code, name) => `Stopped by fault ${code} (${name}).`,
 halted: (cycles, issued) => `Done after ${cycles} cycles; ${issued} warp-instructions issued.`,
 display: 'Display',
 showAll: 'Show all values',
 exportSvg: 'Export drawing as SVG',
 exportPng: 'Export drawing as PNG',
 tabIssue: 'Issue',
 tabMasks: 'Masks',
 tabStack: 'Stack',
 tabResults: 'Results',
 warpsHeading: 'Warps',
 warpCols: Object.freeze(['Warp', 'State', 'PC', 'Mask (lane 0 first)', 'Reconvergence stack (top at right)']),
 stackEmpty: 'empty',
 entry: (kind, mask, to) => (kind === 'R' ? `R ${mask}` : `E ${mask} → ${to}`),
 entryNote: 'R: reconverge entry (the mask to restore); E: else entry (the mask of the other threads and the instruction they go to).',
 laneCols: Object.freeze(['Lane', 'Mask bit', 'Computes', 'Written']),
 on: 'on', off: 'off', none: '—',
 issueHeading: (w, code) => `Coming issue: warp ${w}, ${code}`,
 issueRows: Object.freeze({ pc: 'PC', word: 'Instruction word', mask: 'Active mask (lane 0 first)', pred: 'split: predicate p (lane 0 first)',
 taken: 'Branch taken', end: 'Warp ends (tmc with mask 0)', redirect: 'join returns to', after: 'Mask after the issue' }),
 yes: 'yes', no: 'no',
 masksOnly: 'Masks-only count',
 masksOnlyTitle: 'Hide warp-control instructions (tmc, wspawn, split, join, bar), branches and jumps, and the launch and setup '
 + 'before each warp\'s first predicate; the issues left are those that do the work under a mask.',
 masksCaption: (n, shown) => (shown === n ? `${n} issue${n === 1 ? '' : 's'} so far` : `${shown} of ${n} issues shown`),
 hiddenLine: (h) => `Hidden: ${h.setup} launch and setup, ${h.control} warp control, ${h.branch} branch${h.branch === 1 ? '' : 'es'} or jump${h.branch === 1 ? '' : 's'}.`,
 setupNote: 'Launch and setup: the issues of a warp before the instruction that computes the predicate of its first split.',
 gridCols: Object.freeze({ n: 'Issue', cycle: 'Cycle', warp: 'Warp', code: 'Instruction', lane: (l) => `L${l}`, count: 'Active' }),
 laneCell: (l, bit) => `lane ${l} ${bit === '1' ? 'active' : 'idle'}`,
 gridNote: 'Each row is one issue; a cell is the lane\'s mask bit (1 active, 0 idle and shaded). The last row is the latest issue.',
 gridCut: (n) => `The ${n} earliest rows are left out.`,
 noIssues: 'Nothing has issued yet.',
 stackWarp: 'Warp',
 stackCols: Object.freeze(['Issue', 'Instruction', 'Active mask', 'Stack after the issue (top at right)']),
 resultsHeading: 'This program',
 thisProgram: 'so far',
 resultsLab: 'The laboratory programs (2 warps × 4 lanes)',
 resultsCols: Object.freeze(['Program', 'Cycles', 'Issued', 'Active lane-slots', 'All lane-slots', 'SIMT efficiency']),
 resultsNote: 'SIMT efficiency = active lane-slots ÷ (issued × lanes). The laboratory programs run from their templates, here, '
 + 'when the tab is opened.',
 resultsLoading: 'Running the laboratory programs …',
 resultsFailed: (name) => `${name}: did not run to the end.`,
 fault: 'fault',
 stateFormat: Object.freeze({ 0: 'off', 1: 'ready', 2: 'waiting' }),
 laneCard: Object.freeze({
 title: 'One lane of the coming issue',
 heading: (l, n) => `Lane ${l} of ${n}`,
 strip: 'Active mask of the coming issue, lane 0 first: choose a lane',
 laneBtn: (l, b) => `Lane ${l}, mask bit ${b} (${b ? 'active' : 'idle'})`,
 prev: 'Previous lane', next: 'Next lane',
 whole: 'Whole drawing',
 rows: Object.freeze({ warp: 'Warp', pc: 'PC', instr: 'Instruction', bit: 'Mask bit', computes: 'Computes', written: 'Written (after the gate)' }),
 }),
 }),
 exercise: Object.freeze({
 notGpu: 'This exercise is not for the GPU Laboratory: its file has no "arch": "gpu".',
 badProfile: (p) => `unknown profile "${p}": lab (two warps of four lanes) or lab-l8 (one warp of eight lanes)`,
 wrongProfile: (want, got) => `the exercise is for profile ${want}; the program was assembled for ${got}`,
 notHere: (where, k) => `${where}: "${k}" is a field of another architecture's exercises, not the GPU Laboratory's`,
 noRegisterInputs: (where) => `${where}: a test cannot set or check registers here, since every thread has its own; use memory words`,
 wordsOnly: (where) => `${where}: each memory item needs "at" and "words" (32-bit words)`,
 noLabel: (t) => `the program has no label "${t}"`,
 unaligned: (a) => `address ${a} is not a multiple of 4: the data memory holds words`,
 outside: (a) => `address ${a} is outside the data memory (0 to 1023)`,
 noEnd: (n) => `the warps did not all end (tmc zero) within ${n.toLocaleString('en-GB')} issues`,
 deadlock: 'every running warp waits at a barrier that no other warp will reach',
 fault: (code) => `fault ${code} (${FAULT_NAMES[code]})`,
 about: (n) => `${n} test(s): each writes words of the data memory, runs your program until every warp has ended, and checks the words it leaves.`,
 instructions: (n) => `${n.toLocaleString('en-GB')} warp-instruction(s) issued.`,
 }),
 viewCpuGpu: 'CPU + GPU',
 cpuGpu: Object.freeze({
 title: 'CPU + GPU: the SIMT core as a device of a RISC-V processor',
 heading: 'The GPU on the bus of a RISC-V processor',
 paragraphs: Object.freeze([
 'Here the SIMT core runs on its own. In the CPU + GPU system it is a device of the RISC-V Laboratory\'s single-cycle processor, at 0x5000_1000: the host program copies a kernel and its data into the GPU, starts it, polls STATUS while the GPU issues one warp-instruction per clock cycle, and reads the results back.',
 'The page shows the processor\'s datapath with the GPU on its data bus, and the GPU with its warps, masks and stack as the host program steps. A template, the host running the absolute-value kernel, opens there from Templates.',
 ]),
 open: 'Open the CPU + GPU system',
 mapCaption: 'The GPU\'s registers (MAVILERA\'s design)',
 mapCols: Object.freeze(['Offset', 'Register', 'Meaning']),
 map: Object.freeze([
 ['0x000', 'CTRL', 'write 1: start the kernel (warp 0 at address 0, all lanes); write 2: clear DONE and FAULT'],
 ['0x004', 'STATUS', 'bit 0 BUSY, bit 1 DONE, bit 2 FAULT, bits 11:8 the fault code'],
 ['0x008', 'ARGS', 'kernel_args at launch'],
 ['0x00C', 'BLOCK', 'block_index at launch'],
 ['0x010 to 0x018', 'CYCLES, ISSUED, ACTIVE', 'the counters of the kernel'],
 ['0x400 to 0x4FC', 'IMEM', 'the instruction memory, 64 words'],
 ['0x800 to 0xBFC', 'DMEM', 'the data memory, 256 words'],
 ]),
 mapNote: 'This register map is one way to attach such a core, designed for MAVILERA; a laboratory may ask for a design of your own. Writes are ignored while the GPU is busy; whole words only.',
 kernelHeading: 'Kernel for a host',
 kernelIntro: 'The RISC-V assembler of the host has no warp-control instructions, so a host program carries its kernel as words. Here is the program in the editor, assembled, as lines to paste into a host program\'s data section: its instruction words, each with its source line, and its data words.',
 kernelNone: 'Assemble a kernel to see it here as words for a host program.',
 kernelErrors: 'The program has errors: assemble it without errors first.',
 kernelProfile: 'The GPU on the host\'s bus has two warps of four lanes: choose the profile RISC-V SIMT · 2 warps × 4 lanes and assemble again.',
 copy: 'Copy', copied: 'Copied.', copyByHand: 'The text is selected: copy it with Ctrl+C.', download: 'Download .s',
 }),
 viewModels: 'Models',
 models: Object.freeze({
 panel: 'Models of data-parallel machines',
 tabsLabel: 'Models',
 tabs: Object.freeze({ machines: 'Four machines', amdahl: 'Amdahl', strips: 'Strips', index: 'Indexing', hierarchy: 'Blocks and SMs',
 latency: 'Latency', coalesce: 'Coalescing', banks: 'Banks' }),
 intro: 'Calculators for the ideas behind the SIMT core: what one instruction covers, how a launch becomes warps, and what keeps '
 + 'the lanes busy or idle. Change a value and the tables and drawings follow. Nothing here runs the program in the editor.',
 tooBig: (n, max) => `The drawing shows the first ${max} of ${n}; the tables count all of them.`,
 idleCell: 'idle',
 machines: Object.freeze({
 title: 'One loop, four machines',
 info: ['The loop c[i] = a[i] + b[i] over n elements. A frame is what one instruction covers: one element on a scalar pipeline, '
 + 'a fixed group in one wide register with packed SIMD, up to VLMAX elements of a vector register, and one thread per lane '
 + 'for a warp on a SIMT machine.',
 'Only the additions are counted, not the loads, stores and loop control. When n is not a multiple of the packed width, the '
 + 'remainder is added here by scalar instructions (MAVILERA\'s choice: a packed ISA needs some extra code for it). The vector '
 + 'machine returns vl = min(AVL, VLMAX). The last warp runs with only its threads below n active.'],
 n: 'Elements n', simd: 'Packed width', vlmax: 'VLMAX', warp: 'Warp size',
 rows: Object.freeze({ scalar: 'Scalar pipeline', packed: 'Packed SIMD', vector: 'Vector', simt: 'SIMT' }),
 what: Object.freeze({ scalar: 'one element per instruction', packed: (p) => `${p} elements per instruction`,
 vector: (v) => `up to ${v} elements, length set at run time`, simt: (w) => `one instruction per warp of ${w} threads` }),
 caption: (n) => `Additions for n = ${n}`,
 cols: Object.freeze(['Machine', 'One instruction covers', 'Instructions']),
 remainder: (r) => `${r} remainder element${r === 1 ? '' : 's'} by scalar instruction${r === 1 ? '' : 's'}`,
 lastMask: (m) => `last warp's mask ${m} (lane 0 first)`,
 drawingTitle: 'The elements of each machine, framed by instruction',
 frameTip: (from, to) => (from === to ? `element ${from}` : `elements ${from} to ${to}`),
 }),
 strips: Object.freeze({
 title: 'Strip-mining with a run-time vector length (self-study)',
 info: ['vsetvli receives the application vector length AVL, the elements still to do, and returns vl. With LMUL = 1, '
 + 'VLMAX = VLEN / SEW. The rule: vl = AVL when AVL ≤ VLMAX, vl = VLMAX when AVL ≥ 2 VLMAX, and in between any value from '
 + '⌈AVL / 2⌉ to VLMAX.',
 'A loop that advances by the vl it receives covers exactly n elements whichever permitted value the machine returns. '
 + 'Choose the machine\'s policy to compare. This is a calculator of the rule; the simulator does not run vector instructions.'],
 n: 'Elements n', vlen: 'VLEN (bits)', sew: 'SEW (bits)', policy: 'The machine returns',
 policies: Object.freeze({ max: 'min(AVL, VLMAX)', min: 'the smallest permitted vl' }),
 vlmax: (v) => `VLMAX = ${v}`,
 caption: (n, v) => `Strips for n = ${n}, VLMAX = ${v}`,
 cols: Object.freeze(['Strip', 'AVL', 'Permitted vl', 'vl', 'Elements', 'Remaining']),
 range: (lo, hi) => (lo === hi ? `${lo}` : `${lo} to ${hi}`),
 total: (s, n) => `${s} strip${s === 1 ? '' : 's'}, ${n} elements.`,
 drawingTitle: 'The elements, framed by strip',
 stripTag: (s) => `strip ${s}`,
 }),
 index: Object.freeze({
 title: 'Thread indexing of a launch',
 info: ['A kernel is written for one thread. The launch runs grid_size = ⌈n / block_size⌉ blocks; thread i = block_index × '
 + 'block_size + thread_index. Each block is split into warps of consecutive threads.',
 'Unless n is a multiple of the block size, the last block has threads with i ≥ n, the tail: the test i < n switches '
 + 'them off, so their warp runs with a mask that is not full.'],
 n: 'Elements n', block: 'Block size', warp: 'Warp size', find: 'Find element i',
 caption: 'The launch',
 rows: Object.freeze({ blocks: 'Blocks (grid_size)', threads: 'Threads', warpsPerBlock: 'Warps per block', warps: 'Warps', idle: 'Idle threads (i ≥ n)' }),
 partialCaption: 'Warps whose mask is not full (lane 0 first)',
 partialCols: Object.freeze(['Block', 'Warp', 'First i', 'Mask', 'Active']),
 partialNone: 'Every warp runs with a full mask.',
 partialMore: (n) => `${n} more not listed.`,
 found: (i, b, bs, t, w, l) => `i = ${i}: block ${b}, thread_index ${t} (${b} × ${bs} + ${t} = ${i}), warp ${w}, lane ${l}.`,
 outside: (i, n) => `i = ${i} is not below n = ${n}: its thread is in the tail and does nothing.`,
 notLaunched: (i) => `No thread of this launch has i = ${i}.`,
 drawingTitle: 'Threads of the launch: element i, thread_index below; the tail shaded',
 blockTag: (b) => `block ${b}`, warpTag: (w) => `warp ${w}`,
 }),
 hierarchy: Object.freeze({
 title: 'Blocks, warps and streaming multiprocessors',
 info: ['Each block goes whole to one streaming multiprocessor (SM), which keeps its threads until they finish; inside the SM '
 + 'the block is split into warps of consecutive threads, and the warp is the unit the scheduler issues.',
 'Which SM takes which block is decided by the hardware. Here block b goes to SM b mod (number of SMs), and an SM holds a '
 + 'limited number of blocks at a time, so the blocks run in waves (MAVILERA\'s declared order, not that of any product).'],
 blocks: 'Blocks', block: 'Threads per block', warp: 'Warp size', sms: 'SMs', perSm: 'Blocks per SM at a time', show: 'Expand block',
 smCaption: 'Blocks on each SM',
 smCols: Object.freeze(['SM', 'Blocks (wave)']),
 wave: (b, w) => `${b} (${w + 1})`,
 waves: (n) => `${n} wave${n === 1 ? '' : 's'} of blocks.`,
 warpCaption: (b) => `Block ${b}: its warps`,
 warpCols: Object.freeze(['Warp', 'Threads (thread_index)', 'Lanes used']),
 threads: (a, b) => `${a} to ${b}`,
 }),
 latency: Object.freeze({
 title: 'Latency hiding by switching warps',
 info: ['A declared model: each warp issues k instructions, the k-th a load whose data return L cycles after it issues; the SM '
 + 'issues one instruction per cycle. The scheduler stays with a warp until it has issued its load and then takes the next '
 + 'ready warp in turn (MAVILERA\'s reading of the model).',
 'After a warp\'s load the other W − 1 warps issue k instructions each, so the scheduler never idles when k(W − 1) + 1 ≥ L, '
 + 'that is W ≥ (L − 1) / k + 1. With fewer warps a round takes k − 1 + L cycles and the share of cycles that issue is '
 + 'kW / (k − 1 + L).'],
 W: 'Warps W', k: 'Instructions per load k', L: 'Load latency L', rounds: 'Rounds per warp',
 caption: 'The schedule',
 rows: Object.freeze({ needed: 'Warps needed, (L − 1) / k + 1', cycles: 'Cycles of the run', idle: 'Idle cycles', fraction: 'Share of cycles that issue (steady state)' }),
 timelineCaption: 'Timeline: I issue, L the load, · waiting for its data, – no issue',
 cycle: 'Cycle', warpRow: (w) => `Warp ${w}`, issueRow: 'Issue',
 hidden: 'The latency is hidden: an instruction issues in every cycle.',
 notHidden: (n) => `Too few warps: ${n} idle cycle${n === 1 ? '' : 's'} in the run.`,
 occTitle: 'Occupancy: registers against latency',
 occInfo: ['A warp of w threads that each need r registers takes w × r registers of the SM\'s register file; ⌊register file / '
 + '(w × r)⌋ warps fit. Too few of them, and the latency is no longer hidden.'],
 regFile: 'Register file (registers)', occWarp: 'Warp size', regs: 'Registers per thread', occK: 'Instructions per load k', occL: 'Latency L',
 occCaption: 'Resident warps and issue share',
 occRows: Object.freeze({ perWarp: 'Registers per warp', resident: 'Warps that fit', needed: 'Warps needed', fraction: 'Share of cycles that issue' }),
 occHidden: 'Enough warps fit: the latency is hidden.',
 occNot: 'Too few warps fit: the SM idles while every resident warp waits.',
 }),
 coalesce: Object.freeze({
 title: 'Coalescing a warp\'s load',
 info: ['A warp\'s load is one load per lane. Memory delivers whole aligned blocks; every block that at least one lane needs '
 + 'costs one transaction. Lane i reads the word at byte first + i × stride × word size.',
 'Consecutive words share blocks (coalesced); a stride spreads the lanes over more blocks, and part of each block '
 + 'delivered is not used.'],
 lanes: 'Lanes', word: 'Word size (bytes)', stride: 'Stride (words)', base: 'First byte', blockBytes: 'Block size (bytes)',
 caption: 'Transactions',
 rows: Object.freeze({ transactions: 'Transactions', delivered: 'Bytes delivered', used: 'Bytes used', share: 'Share used' }),
 blocksCaption: 'Blocks the warp needs',
 blocksCols: Object.freeze(['Block', 'Bytes', 'Lanes']),
 bytes: (a, b) => `${a} to ${b}`,
 drawingTitle: 'Lanes and the blocks they need',
 laneTip: (l, a, b) => `lane ${l}: byte ${a}, block ${b}`,
 }),
 banks: Object.freeze({
 title: 'Shared-memory banks',
 info: ['Shared memory is divided into banks, each delivering one word per cycle; word a lies in bank a mod (number of banks). '
 + 'Lane l reads word first + stride × l. Lanes that need different words of one bank are served one after the other: the '
 + 'access takes as many cycles as the busiest bank has distinct words. Lanes that read the same word get it by broadcast.',
 'A tile stored in rows of B words and read by columns has stride B; padding each row by one word changes the stride to '
 + 'B + 1. Try it.'],
 lanes: 'Lanes', banks: 'Banks', stride: 'Stride (words)', base: 'First word',
 caption: (c) => `The access takes ${c} cycle${c === 1 ? '' : 's'}`,
 cols: Object.freeze(['Bank', 'Lanes', 'Distinct words']),
 drawingTitle: 'Banks with the lanes whose word lies in them',
 bankTag: (b) => `bank ${b}`,
 broadcast: 'broadcast',
 }),
 }),
 threads: Object.freeze({
 tab: 'Threads',
 caption: (w, state, n) => `Warp ${w} (${state}): ${n === 0 ? 'every register is 0' : `${n} register${n === 1 ? '' : 's'} not 0 in some thread`}`,
 thread: (w, l) => `Warp ${w} lane ${l}`,
 lane: (l) => `Lane ${l}`,
 on: 'on', off: 'off',
 all: 'Show every register (x1 to x31)',
 allZero: 'Every register of every thread is 0.',
 changed: 'changed by the last step',
 noProgram: 'Assemble a program to see its threads.',
 note: 'Each thread has its own 32 registers, all 0 at launch (x0 is always 0). A lane whose mask bit is 0 keeps its '
 + 'registers; its column is marked “off”. Values in signed decimal; hexadecimal in the tooltip.',
 }),
});

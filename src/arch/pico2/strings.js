// pico2/strings.js -- the pico2 module's interface strings, in British English (WS-N-007), merged over the shell's when the
// descriptor is loaded. Working name "Pico 2 Laboratory" (research repository ADR-0008; the final name and logo follow the
// branding process). The module is registered for the development page only (P1-M1): no release, no landing tile.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const hex = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;

export const PICO2_STRINGS = Object.freeze({
  appFull: 'Pico 2 Laboratory',
  aboutText: 'MAVILERA is an educational platform for exploring microprocessor architecture. This module, the Pico 2 Laboratory, '
    + 'simulates one Hazard3 RISC-V core of the Raspberry Pi RP2350 at the instruction level: RV32IMAC with the bit-manipulation '
    + 'and code-size extensions, machine and user modes, traps, physical memory protection and the external interrupt controller. '
    + 'This development stage adds the Pico 2 machine: the RP2350 address map, the clocks, resets, timers, UARTs, GPIO and the '
    + 'single-cycle IO block, and programs built with the Pico SDK start directly, without the bootrom. Each instruction takes the '
    + 'clock cycles of Hazard3\'s documented timing (with a perfect bus), and the Pipeline view shows its three stages cycle by '
    + 'cycle. The second core, PIO, PWM, DMA and the other peripherals are not modelled yet.',
  viewIsa: 'Instructions',
  viewPipeline: 'Pipeline',
  profileNames: Object.freeze({ hazard3: 'Hazard3 (RP2350)' }),
  registerGroup: 'Registers',
  csrGroup: 'Machine CSRs',
  counterNames: Object.freeze({ instructions: 'Instructions', steps: 'Steps', cycles: 'clk_sys cycles', traps: 'Traps', cacheHits: 'Decode cache hits' }),
  trapLabels: Object.freeze({
    0: 'instruction address misaligned', 1: 'instruction access fault', 2: 'illegal instruction', 3: 'breakpoint',
    4: 'load address misaligned', 5: 'load access fault', 6: 'store/AMO address misaligned', 7: 'store/AMO access fault',
    8: 'environment call from U-mode', 11: 'environment call from M-mode',
    irq3: 'machine software interrupt', irq7: 'machine timer interrupt', irq11: 'machine external interrupt',
  }),
  // the assembler's messages (language.js)
  asm: Object.freeze({
    unknown: (m) => `'${m}' is not a Hazard3 instruction, pseudo-instruction or directive.`,
    unknownNote: 'Compressed instructions are written with their own mnemonic (c.addi, cm.push); the assembler does not compress.',
    badRegister: (t) => `'${t}' is not a register (x0 to x31, or an ABI name such as a0, sp, s1).`,
    needsValue: 'A value is missing.',
    badExpression: (t) => `'${t}' is not an expression (numbers, labels, + and -, %hi() and %lo()).`,
    badNumber: (t) => `'${t}' is not a number.`,
    undefinedSymbol: (n) => `The symbol '${n}' is not defined.`,
    badSymbol: (n) => `'${n}' cannot be a symbol name.`,
    needsSp: 'This operand must be sp.',
    needsMemory: (t) => `'${t}' is not a memory operand: write offset(register), for example 8(sp).`,
    badRlist: (t) => `'${t}' is not a register list: write {ra}, {ra, s0}, or {ra, s0-sN} with N from 1 to 9, or 11.`,
    operandCount: (m, n) => `${m} takes ${n} operand${n === 1 ? '' : 's'}.`,
    badFence: (t) => `'${t}' is not a fence set: use the letters i, o, r and w.`,
    notEncodable: (m) => `These operands cannot be encoded in ${m}.`,
    notEncodableNote: 'A compressed instruction limits its registers (often x8 to x15) and the range and alignment of its immediate; use the 32-bit instruction instead.',
    outOfRange: (m) => `An operand of ${m} is out of range.`,
    outOfRangeNote: (m) => (/^b|^jal$/.test(m) ? 'Branch targets must lie within ±4 KiB and jump targets within ±1 MiB, at even addresses.'
      : 'Immediates are 12-bit signed (−2048 to 2047), shift amounts 0 to 31, CSR addresses 0 to 0xfff, upper immediates 0 to 0xfffff.'),
    liChanged: 'The value of li changed between the passes: define the symbol before the li.',
    codeInData: 'Instructions belong in the .text section.',
    misalignedCode: 'An instruction would start at an odd address: add .align 1 before it.',
    textTooLong: 'The code reaches the .data section at 0x20040000.',
    dataTooLong: 'The data runs past the end of the 520 KiB SRAM.',
    badAlign: (n) => `${n} is not an alignment this directive takes.`,
    badSpace: (n) => `${n} bytes cannot be reserved.`,
    dataRange: (v, w) => `${v} does not fit in ${w === 1 ? 'a byte' : 'a halfword'}.`,
    badString: (t) => `${t} is not a string in double quotes (8-bit characters).`,
    duplicateLabel: (l) => `The label '${l}' is defined twice.`,
  }),
  // the engine's messages (engine.js)
  engine: Object.freeze({
    noHandler: (cause, pc) => `Trap at ${hex(pc)}: ${cause}, and no trap handler is installed (mtvec is 0). The instruction did not complete.`,
    sleepForever: (pc) => `The core sleeps at ${hex(pc)} (wfi or h3.block) with no interrupt enabled: it would sleep for ever.`,
    sleepNoEvent: (pc) => `The core sleeps at ${hex(pc)} and no timer, UART or input event is due that could wake it.`,
    halted: (pc) => `ebreak at ${hex(pc)} ended the program (no trap handler is installed).`,
    romNotModelled: (name, tag, ra) => `The program called the ROM function ${name} ('${tag}', from ${hex(ra)}). The Pico 2 Laboratory boots without the RP2350 bootrom and does not model this function.`,
    romEntry: (pc) => `The program jumped into the bootrom (${hex(pc)}), for example to reboot. The bootrom is not modelled: the Pico 2 Laboratory boots images directly.`,
    imageOutside: (a) => `The image has data at ${hex(a)}, outside the flash and the SRAM.`,
  }),
  // what the program used that the machine does not model, or did in an unusual way (each reported once)
  diag: Object.freeze({
    noRegister: (block, off) => `${block}: no register at offset ${hex(off)}; reads give 0 and writes are ignored.`,
    heldInReset: (block) => `${block} was accessed while RESETS holds it in reset: writes are ignored and reads give reset values.`,
    notModelled: (block) => `${block} is not modelled in this development stage: reads give 0 (or the value last written).`,
    watchdogEnabled: () => 'The watchdog was enabled; its countdown is not modelled.',
    xipWrite: (a) => `Write to the flash window at ${hex(a)} ignored (the flash is read-only here).`,
    uartOverflow: (u) => `${u}: a byte was written while the transmit FIFO was full and was lost.`,
    uartRxDisabled: (u) => `${u}: input arrived while the receiver was disabled and was lost.`,
    uartRxOverrun: (u) => `${u}: the receive FIFO overflowed.`,
    gpioFunction: (pin, f) => `GPIO ${pin} selects ${f}, which is not modelled: the pin is not driven.`,
    sioFifo: () => 'The inter-core FIFO was written; core 1 is not modelled and never reads it.',
    sioInterp: () => 'The SIO interpolators are not modelled: their registers only hold what was written.',
    sioDoorbell: () => 'The SIO doorbells are not modelled (core 1 is not modelled).',
    sioTmds: () => 'The SIO TMDS encoder is not modelled.',
    clkSysStopped: () => 'clk_sys would stop with this clock configuration; the simulator keeps the previous frequency.',
    romData: (code) => `The ROM data item '${code}' was looked up; the module's ROM holds no data items (the lookup returns 0).`,
  }),
  // the pipeline view (ui/pipeline-view.js, P1-M3)
  pipeline: Object.freeze({
    title: 'Hazard3 pipeline: F, X, M',
    infoTitle: 'Pipeline details',
    stages: Object.freeze({ F: 'F  fetch', X: 'X  decode and execute', M: 'M  memory and write', W: 'after M' }),
    bars: Object.freeze({ FX: 'F / X', XM: 'X / M', MW: 'M / W' }),
    units: Object.freeze({
      FETCH: 'Fetch', NPC: 'Next fetch address', BTB: 'Branch target buffer', DEC: 'Decode', RF: 'Registers', BYP1: 'rs1 bypass', BYP2: 'rs2 bypass',
      ALU: 'ALU', ADDR: 'Address adder', CMP: 'Branch compare', MULDIV: 'Multiply / divide', CSR: 'CSR port', AMO: 'AMO sequencer',
      CTRL: 'Stall and jump control', DBUS: 'Data bus (perfect)', RES: 'Result (m_result)', STD: 'Store data', TRAP: 'Trap entry', MW: 'Last write',
    }),
    unitHelp: Object.freeze({
      FETCH: 'The instruction that enters X next. The prefetch buffer and the instruction register of the real frontend are not drawn',
      NPC: 'Where the next fetch comes from: the next instruction, the branch target buffer\'s prediction, a jump or branch from X, or a trap',
      BTB: 'One entry: the last taken backward branch, which is then predicted taken (RP2350 datasheet §3.8.7.10)',
      DEC: 'Decodes the instruction in X (compressed and Zcmp instructions are expanded here in the RP2350\'s Hazard3)',
      RF: 'x0 to x31: read with the addresses predecoded in F, written at the end of M',
      BYP1: 'Chooses rs1: the register file, the result of the instruction in M (xm), the value written last cycle (mw), or zero for x0',
      BYP2: 'Chooses rs2 in the same way',
      ALU: 'Arithmetic, logic and bit manipulation; its result goes into the X/M register',
      ADDR: 'One adder for load and store addresses and for branch and jump targets',
      CMP: 'Compares rs1 and rs2 for a conditional branch; the branch is resolved in X',
      MULDIV: 'mul and mulh* in one cycle; div and rem hold X for 18 or 19 cycles',
      CSR: 'Reads and writes the control and status registers in X',
      AMO: 'An atomic memory operation holds X for four cycles: read address, read data, write address, write data',
      CTRL: 'Holds X (a stall) or redirects the fetch (a jump, a mispredicted branch, a trap), and updates the branch target buffer',
      DBUS: 'Address phase in X, data phase in M. Every access completes at once here: the RP2350\'s wait states are not modelled',
      RES: 'The result the instruction in M writes to rd: the X result, or the load data',
      STD: 'Store data, forwarded from the last write (mw_result) when it is the register just loaded',
      TRAP: 'Exceptions are taken when their instruction reaches M; interrupts between the instructions in M and X',
      MW: 'The register written in the cycle before, kept for forwarding into X and into the store data',
    }),
    // lines of the units (values filled by the view)
    lines: Object.freeze({
      fPc: (pc) => `pc ${pc}`, fNone: '(nothing fetched)', fWrong: 'wrong path: discarded', fTarget: 'fetching the target', fNext: 'next instruction',
      npcSeq: 'next instruction', npcBtb: 'predicted by the BTB', npcJump: 'jump or branch from X', npcTrap: 'trap: mtvec, or mepc for mret',
      xEmpty: 'empty (a bubble)', xExec: 'executes', xStall: 'held (stall)', xSquash: 'squashed by the interrupt', xSleep: 'asleep', xUop: (n) => `micro-op ${n}`,
      cause: (w) => `cause: ${w}`, none: '—', yes: 'yes', idle: 'idle', busy: 'busy',
      busRead: 'read (data phase in M)', busWrite: 'write (data phase in M)', addrMem: 'load/store address', addrJump: 'jump or branch target',
      branchTaken: 'taken', branchNot: 'not taken', predicted: 'predicted taken', trapTo: (t) => `to ${t}`,
      repeat: (n) => `${n} cycles (a sleep the simulator skipped)`,
    }),
    why: Object.freeze({
      0: '', 1: 'load-use: rs waits for the load in M', 2: 'exclusive access after lr.w or sc.w', 3: 'multiply/divide busy', 4: 'AMO in progress',
      5: 'Zcmp micro-operations', 6: 'second fetch of a 32-bit instruction that is not word aligned', 7: 'bubble after a jump',
      8: 'bubble after a mispredicted branch', 9: 'trap entry', 10: 'interrupt entry', 11: 'asleep (wfi, h3.block)', 12: 'wfi', 13: 'h3.block',
      14: 'div cancelled by an interrupt', 15: 'ROM function (serviced in one cycle, not modelled)',
    }),
    bypass: Object.freeze(['—', 'register file', 'xm_result (M)', 'mw_result (after M)', 'zero (x0)']),
    // tabs
    tabStages: 'Stages', tabDiagram: 'Diagram', tabHazards: 'Hazards', tabBtb: 'BTB', tabSignals: 'Signals', tabHelp: 'Help',
    stageCol: 'Stage', holdsCol: 'Holds', stateCol: 'State', whyCol: 'Why',
    stageNames: Object.freeze({ F: 'F', X: 'X', M: 'M', W: 'after M' }),
    diagramCaption: 'Pipeline diagram: the newest instructions (rows) over the clock cycles (columns). Activate a cycle to show it.',
    diagramInstr: 'Instruction', cellNames: Object.freeze({ 1: 'F', 2: 'X', 3: 'M', 4: 'stall', 5: 'squashed', 6: 'wrong path', 7: 'micro-op', 8: 'F (second half)', 9: 'sleep' }),
    cellShort: Object.freeze({ 1: 'F', 2: 'X', 3: 'M', 4: 'x', 5: '–', 6: '', 7: 'u', 8: 'F', 9: 'z' }),
    goCycle: (c) => `Show cycle ${c}`,
    hazardsCaption: 'Cycles by cause over the cycles kept, and the hazards counted',
    causeCol: 'Cause', cyclesCol: 'Cycles', cpiCol: 'CPI share', countCol: 'Count',
    categories: Object.freeze({ base: 'instruction in X (base)', loadUse: 'load-use stalls', exclusive: 'exclusive-access bubbles', fetch: 'second fetch (misaligned 32-bit target)',
      jump: 'jump bubbles', mispredict: 'mispredicted branches', multi: 'multi-cycle (div, AMO, Zcmp, wfi)', trap: 'trap entry', irq: 'interrupt entry', sleep: 'asleep' }),
    totals: (cycles, instr, cpi) => `${cycles} cycles, ${instr} instructions, CPI ${cpi}`,
    hazards: Object.freeze({ loadUse: 'load-use stalls', exclusive: 'exclusive bubbles', fetch: 'misaligned targets', jump: 'jumps', mispredict: 'mispredicted branches',
      predicted: 'correctly predicted taken branches', trap: 'exceptions', irq: 'interrupts', divCancelled: 'div cancelled by an interrupt' }),
    btbCaption: 'The branch target buffer in the cycle shown',
    btbValid: 'valid (btb_valid)', btbSrc: 'branch address (btb_src_addr)', btbEmpty: 'empty', btbNote: 'A taken backward branch enters it; a branch it predicts taken that is then not taken clears it, and so do fence.i and every trap. A loop whose branch and target lie in the same 32-bit word is not predicted (the datasheet\'s delay-loop caveat).',
    signalsCaption: 'Every signal of the cycle shown (names as in the Hazard3 RTL)', signalCol: 'Signal', valueCol: 'Value', meaningCol: 'Meaning',
    signalHelp: Object.freeze({
      btb_src_addr: 'address of the branch held in the branch target buffer', btb_valid: 'the branch target buffer holds a branch',
      d_pc: 'address of the instruction in X', d_rs1: 'first source register of the instruction in X', d_rs2: 'second source register', d_rd: 'destination register',
      x_rs1_bypass: 'where rs1 comes from: register file, xm_result, mw_result or zero', x_rs2_bypass: 'where rs2 comes from',
      x_stall: 'X is held this cycle', x_stall_on_raw: 'held: a source register is the result of the load in M', x_stall_on_exclusive_overlap: 'held: an exclusive access follows lr.w or sc.w',
      x_stall_muldiv: 'held: the divider is busy', x_stall_on_amo: 'held: an AMO is in progress', x_jump_req: 'X redirects the fetch (jump, mispredicted branch, mret, fence.i)',
      x_branch_was_predicted: 'the branch in X was predicted taken', x_btb_set: 'the branch in X enters the branch target buffer',
      xm_rd: 'destination register of the instruction in M', m_reg_wen: 'the instruction in M writes a register', m_result: 'the value it writes',
      m_trap_enter_vld: 'a trap is taken this cycle', m_trap_is_irq: 'the trap is an interrupt', mw_rd: 'the register written in the cycle before', mw_result: 'the value written then',
    }),
    // header and status
    stepInstr: 'Step instruction', stepInstrTitle: 'Run to the first cycle of the next instruction',
    backInstr: 'Back instruction', backInstrTitle: 'Go back to the first cycle of the instruction before',
    status: (cycle, clk, cpi) => `cycle ${cycle} · ${clk} clk_sys cycles · CPI ${cpi}`,
    haltedAt: (pc, retired, cycle) => `ebreak at ${pc}: ${retired} instructions in ${cycle} clk_sys cycles.`,
    counters: Object.freeze({ cycles: 'clk_sys cycles', records: 'Cycles shown', instructions: 'Instructions', cpi: 'CPI', stalls: 'Stall cycles', bubbles: 'Bubble cycles' }),
    // the help tab: original text (C4, C5); sources: RP2350 datasheet §3.8.7 (RP-001), research report R-HZ-01, E-TIMING-1
    help: Object.freeze([
      ['What this view shows', 'Hazard3, the RISC-V core of the RP2350, has three pipeline stages. F fetches the next instruction and reads its source registers. X decodes and executes it: the ALU, the branch decision, the address of a load or store, the CSRs, multiply and divide. M completes a load or store on the bus, takes exceptions and writes the result register at its end. Each column of the diagram is one clock cycle of clk_sys.'],
      ['Compared with the five-stage teaching pipeline', 'The RISC-V Laboratory\'s pipelined processor has five stages: IF, ID, EX, MEM and WB. Hazard3 decodes inside X, so it has no separate ID stage, and it writes the register file at the end of M, so it has no separate WB stage. Both forward results: Hazard3 into X from the instruction in M (xm_result) and from the value written in the cycle before (mw_result), and into a store\'s data in M. In both a load followed at once by an instruction that uses its result costs one stall cycle; Hazard3 does not stall when the loaded value is only stored. Hazard3 resolves branches in X, one stage after fetch, so a jump or a mispredicted branch costs one bubble (two cycles in all); the teaching pipeline resolves them in EX and loses two cycles (one with its early-resolution setting). Hazard3 predicts with a single entry that remembers the last taken backward branch; the teaching pipeline offers no prediction or a table of 1-bit or 2-bit counters.'],
      ['Where the cycle counts come from', 'Every count is the RP2350 datasheet\'s (section 3.8.7, Hazard3 instruction timing): one cycle for most instructions, a stall after a load that is used at once, two cycles for jal and jalr, one or two for a branch, 18 or 19 for div and rem, four for an AMO, 1 + n for cm.push and cm.pop, three to enter a trap. Where the datasheet says nothing (fence, fence.i, h3.block, exception and interrupt entry, a predicted branch to a misaligned target), the counts were measured in a simulation of the Hazard3 RTL at the RP2350\'s revision (the research repository\'s experiment E-TIMING-1): fence 1, fence.i 2, exception entry 3, interrupt entry 2, and an interrupt cancels a div in progress, which runs again after the handler. Which div and rem operands take 19 cycles the datasheet does not say; the simulator takes 19 when the dividend of div or rem is negative, as the RTL does (an inference).'],
      ['Where the RTL and the datasheet differ', 'In the RTL simulation divu and remu took 19 cycles (datasheet 18), div and rem 19, or 20 with a negative dividend (datasheet 18 or 19), mret 3 (datasheet 2) and cm.popretz with one register 4 (datasheet 5). The simulator uses the datasheet values. Which is right on the silicon is not known: no Pico 2 was measured.'],
      ['Limitations', 'The bus is perfect: every fetch, load and store completes without wait states, as the datasheet\'s counts assume. Code in the XIP flash, the APB peripherals and conflicts between SRAM banks take longer on a real RP2350; that is not modelled. The frontend is drawn without its prefetch buffer and instruction register, so F shows the instruction that enters X next, not the bus fetch. The values of the stages are the simulator\'s stage model, built from the same rules as the cycle counts; they are not taken from the RTL. A long sleep that the simulator skips is one column.'],
      ['Signal names', 'The signals are named as in the Hazard3 RTL (version 1.0-rc1, the RP2350\'s revision); each has a plain description in the Signals tab. x_rs1_bypass and x_rs2_bypass are values in the RTL; here they show which input the multiplexer chose.'],
    ]),
    wave: Object.freeze({ label: 'Hazard3 pipeline (stage model)' }),
  }),
  // why an item of the shell is disabled for the pico2 module (contract capabilities)
  capability: Object.freeze({
    cRiscvOnly: 'The C compiler belongs to the RISC-V Laboratory; this module is programmed in Hazard3 assembly language.',
    laterMilestone: 'Not built yet in this development stage of the Pico 2 Laboratory.',
    noDevices: 'The peripheral views of the Pico 2 Laboratory are not built yet in this development stage.',
    oneProcessor: 'One view only: there is nothing to compare.',
  }),
});

// programs-ch08.mjs -- generated test programs for the Chapter 8 pipelined
// model (used by pipe.test.mjs and rtl-pipe.test.mjs; contains no tests).
// Deterministic for a given seed.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

function prng(seed) { // xorshift32
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}

const ALU_R = ['add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and'];
const ALU_I = ['addi', 'slti', 'sltiu', 'xori', 'ori', 'andi'];
const BR = ['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu'];

/**
 * A Chapter 8 program dense in hazards: sources drawn mostly from the last
 * destinations (forwarding from MEM and WB), loads followed by readers
 * (load-use), forward branches, counted loops (prediction), calls and returns.
 * x1..x12 are free; x13 is the data base (64); x14 the loop counter; x16 the link.
 */
export function program(seed, n) {
  const rnd = prng(seed);
  const pick = (a) => a[rnd() % a.length];
  const recent = [];
  const dst = () => { const r = 1 + (rnd() % 12); recent.unshift(r); recent.length = Math.min(recent.length, 3); return `x${r}`; };
  const src = () => (recent.length && rnd() % 3 ? `x${pick(recent)}` : `x${rnd() % 13}`);
  const lines = ['        addi x13, x0, 64'];
  for (let r = 1; r <= 12; r++) lines.push(`        addi x${r}, x0, ${(rnd() % 4096) - 2048}`);
  let label = 0;
  const body = (k) => {
    for (let i = 0; i < k; i++) {
      const t = rnd() % 16;
      if (t < 5) lines.push(`        ${pick(ALU_R)} ${dst()}, ${src()}, ${src()}`);
      else if (t < 8) lines.push(`        ${pick(ALU_I)} ${dst()}, ${src()}, ${(rnd() % 4096) - 2048}`);
      else if (t < 9) lines.push(`        ${pick(['slli', 'srli', 'srai'])} ${dst()}, ${src()}, ${rnd() % 32}`);
      else if (t < 10) lines.push(`        ${pick(['lui', 'auipc'])} ${dst()}, ${rnd() % 0x100000}`);
      else if (t < 12) { const s = src(); lines.push(`        lw ${dst()}, ${4 * (rnd() % 32)}(x13)`, `        add ${dst()}, ${s}, x${recent[1]}`); }
      else if (t < 13) lines.push(`        sw ${src()}, ${4 * (rnd() % 32)}(x13)`);
      else if (t < 15) { const l = `f${label++}`; lines.push(`        ${pick(BR)} ${src()}, ${src()}, ${l}`, `        addi ${dst()}, ${src()}, 1`, `${l}:`); }
      else { const l = `j${label++}`; lines.push(`        jal x0, ${l}`, `        addi ${dst()}, x0, 7`, `${l}:`); }
    }
  };
  for (let part = 0; part < n; part++) {
    const t = rnd() % 3;
    if (t === 0) body(4);
    else if (t === 1) { // counted loop with a backward branch
      const l = `L${label++}`;
      lines.push(`        addi x14, x0, ${2 + (rnd() % 6)}`, `${l}:`);
      body(2);
      lines.push('        addi x14, x14, -1', `        bne x14, x0, ${l}`);
    } else { // call and return
      const f = `F${label++}`;
      const after = `A${label++}`;
      lines.push(`        jal x16, ${f}`, `        jal x0, ${after}`, `${f}:`);
      body(2);
      lines.push('        jalr x0, 0(x16)', `${after}:`);
    }
  }
  lines.push('        halt');
  return lines.join('\n') + '\n';
}

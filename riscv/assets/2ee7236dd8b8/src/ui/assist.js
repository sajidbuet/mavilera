// assist.js -- completion and hover help of the assembly editor (WS-U-021):
// which kind of word the cursor is completing (a mnemonic at the start of a
// statement, a register in an operand), the candidates with their operand
// syntax, and the help for a word: its operand syntax, format and operation
// in register-transfer notation, or what a pseudo-instruction becomes. The
// help text is the simulator's own (strings.js, C4). No DOM: the editor
// draws the list and the tooltip.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { INSTRUCTIONS, ABI_NAMES } from '../isa/encoding.js';
import { PSEUDOS, usage } from '../asm/assembler.js';
import { STRINGS } from './strings.js';

const MNEMONICS = [...Object.keys(INSTRUCTIONS), ...PSEUDOS].sort();
const REGS = [...ABI_NAMES.map((n, i) => ({ name: n, x: i })), { name: 'fp', x: 8 }, ...ABI_NAMES.map((_, i) => ({ name: `x${i}`, x: i }))];

const role = (abi) => {
  const R = STRINGS.assist.regRoles;
  return R[abi] ?? R[abi[0]] ?? '';
};

/**
 * What the text before the cursor is completing: {kind: 'mnemonic'|'register', prefix, from}
 * (from: the column where the word starts), or null. A mnemonic is the first word of a
 * statement (after any labels); a register is a word in the operands after a space,
 * a comma or an opening parenthesis. Nothing inside a comment or a string.
 */
export function completionContext(before) {
  if (/#/.test(before.replace(/"(?:\\.|[^"])*"|'(?:\\.|[^'])'/g, '')) || /"[^"]*$/.test(before)) return null;
  const head = /^(\s*(?:[A-Za-z_.$][\w.$]*:\s*)*)([A-Za-z][\w.]*)$/.exec(before);
  if (head) return { kind: 'mnemonic', prefix: head[2], from: head[1].length };
  const op = /^\s*(?:[A-Za-z_.$][\w.$]*:\s*)*[A-Za-z][\w.]*\s+.*?(?:^|[\s,(])([A-Za-z][\w]*)$/.exec(before);
  if (op && !/^\s*(?:[A-Za-z_.$][\w.$]*:\s*)*\./.test(before)) return { kind: 'register', prefix: op[1], from: before.length - op[1].length };
  return null;
}

/** Candidates for a context: [{label, detail}], prefix matches first in table order, at most `limit`. */
export function completions(ctx, limit = 8) {
  if (!ctx || !ctx.prefix) return [];
  const p = ctx.prefix.toLowerCase();
  if (ctx.kind === 'mnemonic') {
    return MNEMONICS.filter((m) => m.startsWith(p) && m !== p).slice(0, limit)
      .map((m) => ({ label: m, detail: usage(m) ?? m }));
  }
  return REGS.filter((r) => r.name.startsWith(p) && r.name !== p).slice(0, limit)
    .map((r) => ({ label: r.name, detail: `${r.name.startsWith('x') ? `${ABI_NAMES[r.x]}` : `x${r.x}`}${role(ABI_NAMES[r.x]) ? `, ${role(r.name === 'fp' ? 'fp' : ABI_NAMES[r.x])}` : ''}` }));
}

/** Whether the word typed is already a whole mnemonic or register (then the list offers longer ones without choosing one). */
export function isComplete(ctx) {
  if (!ctx?.prefix) return false;
  const p = ctx.prefix.toLowerCase();
  return ctx.kind === 'mnemonic' ? MNEMONICS.includes(p) : REGS.some((r) => r.name === p);
}

/** The word at column `col` (0-based) of a line: {word, from, to}, or null. */
export function wordAt(line, col) {
  const re = /[A-Za-z_.$][\w.$]*/g;
  for (const m of line.matchAll(re)) {
    if (col >= m.index && col < m.index + m[0].length) return { word: m[0], from: m.index, to: m.index + m[0].length };
  }
  return null;
}

/**
 * Help for a word of an assembly line: an instruction {kind: 'instr', usage, format, operation},
 * a pseudo-instruction {kind: 'pseudo', usage, operation}, a register {kind: 'register', text},
 * or null. Words after a '#' are a comment and get none.
 */
export function helpFor(line, col) {
  const w = wordAt(line, col);
  if (!w) return null;
  const hash = line.indexOf('#');
  if (hash >= 0 && hash < w.from) return null;
  const word = w.word.toLowerCase();
  if (INSTRUCTIONS[word]) {
    return { kind: 'instr', word, usage: usage(word), format: STRINGS.assist.format(INSTRUCTIONS[word].fmt), operation: STRINGS.semantics[word] ?? '' };
  }
  if (PSEUDOS.includes(word)) return { kind: 'pseudo', word, usage: usage(word), operation: STRINGS.pseudoSemantics[word] ?? '' };
  const r = REGS.find((x) => x.name === word);
  if (r) {
    const abi = ABI_NAMES[r.x];
    const text = `${word === abi ? `${abi} = x${r.x}` : word === 'fp' ? 'fp = s0 = x8' : `x${r.x} = ${abi}`}${role(word === 'fp' ? 'fp' : abi) ? `: ${role(word === 'fp' ? 'fp' : abi)}` : ''}`;
    return { kind: 'register', word, text };
  }
  return null;
}

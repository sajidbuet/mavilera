// assist.js -- completion and hover help of the assembly editor (WS-U-021):
// which kind of word the cursor is completing (a mnemonic at the start of a
// statement, a register in an operand), the candidates with their detail, and
// the help for a word. The words, details and help are the architecture's
// (contract v5 Language.editor: mnemonics, registers, detail, help); this
// module only finds the word. No DOM: the editor draws the list and the tooltip.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What the text before the cursor is completing: {kind: 'mnemonic'|'register', prefix, from}
 * (from: the column where the word starts), or null. A mnemonic is the first word of a
 * statement (after any labels); a register is a word in the operands after a space,
 * a comma or an opening parenthesis. Nothing inside a comment (from `comment`) or a string.
 */
export function completionContext(before, comment = '#') {
  if (new RegExp(esc(comment)).test(before.replace(/"(?:\\.|[^"])*"|'(?:\\.|[^'])'/g, '')) || /"[^"]*$/.test(before)) return null;
  const head = /^(\s*(?:[A-Za-z_.$][\w.$]*:\s*)*)([A-Za-z][\w.]*)$/.exec(before);
  if (head) return { kind: 'mnemonic', prefix: head[2], from: head[1].length };
  const op = /^\s*(?:[A-Za-z_.$][\w.$]*:\s*)*[A-Za-z][\w.]*\s+.*?(?:^|[\s,(])([A-Za-z][\w]*)$/.exec(before);
  if (op && !/^\s*(?:[A-Za-z_.$][\w.$]*:\s*)*\./.test(before)) return { kind: 'register', prefix: op[1], from: before.length - op[1].length };
  return null;
}

/** Candidates for a context from the editor data `E`: [{label, detail}], prefix matches first in table order, at most `limit`. */
export function completions(ctx, E, limit = 8) {
  if (!ctx || !ctx.prefix) return [];
  const p = ctx.prefix.toLowerCase();
  const words = ctx.kind === 'mnemonic' ? E.mnemonics : E.registers;
  return words.filter((w) => w.startsWith(p) && w !== p).slice(0, limit).map((w) => ({ label: w, detail: E.detail?.(w, ctx.kind) ?? '' }));
}

/** Whether the word typed is already a whole mnemonic or register (then the list offers longer ones without choosing one). */
export function isComplete(ctx, E) {
  if (!ctx?.prefix) return false;
  const p = ctx.prefix.toLowerCase();
  return (ctx.kind === 'mnemonic' ? E.mnemonics : E.registers).includes(p);
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
 * Help for a word of an assembly line: the architecture's help ({kind: 'instruction'|'pseudo'|'register', usage,
 * format, operation, text}) with the word, or null. Words after the comment prefix get none.
 */
export function helpFor(line, col, E, comment = '#') {
  const w = wordAt(line, col);
  if (!w || !E.help) return null;
  const c = line.indexOf(comment);
  if (c >= 0 && c < w.from) return null;
  const word = w.word.toLowerCase();
  const h = E.help(word);
  return h ? { ...h, word } : null;
}

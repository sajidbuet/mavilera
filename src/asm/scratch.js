// scratch.js -- the encode/decode scratchpad (WS-F-024): one instruction to
// its machine word(s), or one machine word to its instruction, without
// assembling a program. Encoding uses the assembler on a one-line program at
// address 0, so a branch or jump takes a numeric byte offset (labels are not
// defined here); a pseudo-instruction gives every word it expands to.
// Decoding takes a word written 0x… (or eight hexadecimal digits) or 0b….
// The results have the shape of listing lines, for the instruction inspector.
// Pure JavaScript, no DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { assemble } from './assembler.js';
import { disassemble } from './disassembler.js';
import { decodeMnemonic, OPCODE, immB, immJ } from '../isa/encoding.js';

/** A machine word written as 0x…, eight hex digits, or 0b…; null if the text is not one. */
export function parseWord(text) {
  const t = text.trim().replace(/_/g, '');
  let v = null;
  if (/^0x[0-9a-f]{1,8}$/i.test(t) || /^[0-9a-f]{8}$/i.test(t)) v = parseInt(t.replace(/^0x/i, ''), 16);
  else if (/^0b[01]{1,32}$/i.test(t)) v = parseInt(t.slice(2), 2);
  return v === null ? null : v >>> 0;
}

/**
 * Encode or decode one line of the scratchpad.
 * Returns {kind: 'decode', ok, lines: [line], text} for a word, where ok is false if the
 * word is no RV32I/M instruction; {kind: 'encode', ok: true, lines} for an instruction;
 * {kind: 'encode', ok: false, error: {message, hint, ...}} when it does not assemble;
 * {kind: 'empty'} for blank input.
 */
export function scratch(text) {
  const t = text.trim();
  if (!t) return { kind: 'empty' };
  const word = parseWord(t);
  if (word !== null) {
    const mn = decodeMnemonic(word);
    let asm = mn ? disassemble(word, 0) : null;
    // a branch or jal shows its byte offset in decimal, as the scratchpad takes it (the listing shows the target address)
    const op = word & 0x7f;
    if (asm && (op === OPCODE.BRANCH || op === OPCODE.JAL)) asm = asm.replace(/[0-9a-f]+$/, String(op === OPCODE.JAL ? immJ(word) : immB(word)));
    return { kind: 'decode', ok: Boolean(mn), word, text: asm,
      lines: mn ? [{ address: 0, word, mnemonic: mn, source: mn, file: 'scratch', line: 1, text: asm, part: 0, parts: 1, operands: [] }] : [] };
  }
  if (/:/.test(t.replace(/"[^"]*"|'[^']*'/g, '')) || /^\s*\./.test(t)) {
    return { kind: 'encode', ok: false, error: { message: 'one instruction only: no label or directive', hint: 'scratchOne' } };
  }
  const p = assemble([{ name: 'scratch', text: t }], { profile: 'iss' });
  if (!p.ok) return { kind: 'encode', ok: false, error: p.errors[0] };
  if (!p.listing.length) return { kind: 'empty' };
  return { kind: 'encode', ok: true, lines: p.listing };
}

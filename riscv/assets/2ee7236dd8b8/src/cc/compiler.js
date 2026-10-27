// compiler.js -- the C-subset compiler of the simulator (spec §10.1, M5):
// preprocess, parse, check, generate. The result is assembly for the
// simulator's own assembler, with a map from each assembly line to the C
// line it comes from (WS-F-082). Targets (WS-F-083): the `iss` profile as
// RV32I or RV32IM, and the processors of Chapters 6-8 (their instruction
// subset, word access only, stack at 0x400, main returning to the halt).
// Pure JavaScript; runs in the page and under Node.js.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { CError } from './lexer.js';
import { preprocess } from './preprocess.js';
import { Parser } from './parser.js';
import { check } from './check.js';
import { generate } from './codegen.js';
import { PROFILES } from '../core/profiles.js';

export const MODES = Object.freeze(['plain', 'register']);
export const MARCHES = Object.freeze(['rv32im', 'rv32i']);

/**
 * Compile C source.
 * @param {string} source
 * @param {{name?: string, profile?: string, march?: string, mode?: string, defines?: object, lbu?: boolean}} options
 *   march: 'rv32im' or 'rv32i' for the iss profile (the chapter processors have no M extension);
 *   mode: 'plain' or 'register' (WS-F-081); defines: -D names; lbu: the Chapter 6 lbu extension
 * @returns {{ok: boolean, errors: Array<{line, column, message, subset}>, asm: string, map: number[], routines: string[]}}
 *   map[k]: the C line of assembly line k + 1 (0: start-up and library code)
 */
export function compile(source, { name = 'main.c', profile = 'iss', march = 'rv32im', mode = 'plain', defines = {}, lbu = false } = {}) {
  const target = { profile, m: profile === 'iss' && march === 'rv32im', lbu: profile === 'ch06' && lbu, mode };
  try {
    const { tokens, includes } = preprocess(source, { defines });
    const ast = new Parser(tokens, { stdint: includes.has('stdint.h') }).program();
    const checked = check(ast);
    const { lines, routines } = generate(checked, target, source.split(/\r?\n/));
    const isa = profile === 'iss' ? march.toUpperCase() : `the ${PROFILES[profile].processor}`;
    const head = [
      `# ${name}, compiled by MAVILERA (C subset, ${mode} mode, ${isa}).`,
      '# A teaching translation, one statement at a time: a real compiler (GCC) produces different code.',
    ];
    const all = [...head.map((text) => ({ text, cline: 0 })), ...lines];
    return { ok: true, errors: [], asm: `${all.map((l) => l.text).join('\n')}\n`, map: all.map((l) => l.cline), routines };
  } catch (e) {
    if (!(e instanceof CError)) throw e;
    return { ok: false, errors: [{ line: e.line, column: e.column, message: e.message, subset: e.subset }], asm: '', map: [], routines: [] };
  }
}

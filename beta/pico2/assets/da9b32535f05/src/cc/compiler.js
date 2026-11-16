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
export function compile(source, { name = 'main.c', profile = 'iss', march = 'rv32im', mode = 'plain', defines = {}, lbu = false, target: def = null } = {}) {
 const target = def ? { profile, m: def.m !== false, lbu: false, mode, def }
 : { profile, m: profile === 'iss' && march === 'rv32im', lbu: profile === 'ch06' && lbu, mode };
 try {
 const headers = def?.headers ?? {};
 const { tokens, includes } = preprocess(source, { defines, headers });
 const stdint = includes.has('stdint.h') || [...includes].some((h) => headers[h]?.stdint);
 const ast = new Parser(tokens, { stdint }).program();
 const builtins = Object.assign({}, def?.builtins ?? {}, ...[...includes].map((h) => headers[h]?.builtins ?? {}));
 const checked = check(ast, { builtins });
 const { lines, routines } = generate(checked, target, source.split(/\r?\n/));
 const isa = def ? def.label : profile === 'iss' ? march.toUpperCase() : `the ${PROFILES[profile].processor}`;
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

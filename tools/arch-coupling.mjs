// arch-coupling.mjs -- the RISC-V references in the interface code (architecture contract, phase 0): imports of the
// RISC-V modules (isa, asm, core, uarch, cc, worker) from main.js, src/ui/ and src/shell/, RISC-V names and the view and profile
// identifiers in their code, and the interface strings that name RISC-V things. A pattern scan, not a
// classification: it measures the coupling and shows it shrink as the shell is extracted.
//
//   node tools/arch-coupling.mjs [--lines] [--json]
//
// Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './site-files.mjs';

/** Modules that belong to the RISC-V architecture (its ISA, assembler, engines, models and compiler). */
const ARCH_IMPORT = /from '\.{1,2}\/(?:\.\.\/)?(isa|asm|core|uarch|cc|worker)\//;
const PATTERNS = {
  import: ARCH_IMPORT,
  // a call of the contract (`language.disassemble(…)`, `engine.callStack()`) is not a reference: `(?<!\.)`.
  // STOP has been the contract's since phase 3 (src/arch/contract.js), so it is no longer counted.
  isa: /(?<!\.)\b(ABI_NAMES|INSTRUCTIONS|PSEUDOS|OPCODE|FORMAT_FIELDS|CLASSES|HALT_WORD|decodeMnemonic|disassemble\w*|assemble|hexImage|readWords|sext)\b/,
  engine: /(?<!\.)\b(Session|PROFILES|SingleCycle|Multicycle|Pipeline|callStack|scratch|compileC|loadCompiler|M_MODE|causeText)\b/,
  ids: /'(isa|single|multi|pipe|compare|iss|iss-priv|ch06|ch07|ch08)'/,
  names: /\b(RISC-V|RV32[IM]*|x0|a[0-7]|ecall|ebreak|jalr|mstatus|mtvec|mepc|mcause|csr\w*)\b/i,
};
// RISC-V words in interface text (strings.js): mnemonics, register names, ISA and trap terms.
const STRING_WORDS = /\b(RISC-V|RV32I?M?|x0|x1|sp|ra|a[0-7]|t[0-6]|s(?:[0-9]|1[01])|ecall|ebreak|jalr?|lui|auipc|beq|bne|lw|sw|addi|mret|csr\w*|mstatus|mtvec|mepc|mcause|ABI|funct[37]|opcode|rs[12]|rd|imm)\b/;

// the shell: main.js, src/ui/ and (from phase 4) src/shell/; the RISC-V view modules moved to src/arch/riscv/ui/ in phase 4
const files = ['src/main.js', ...['ui', 'shell'].flatMap((d) => readdirSync(join(ROOT, 'src', d)).filter((f) => f.endsWith('.js') && f !== 'strings.js').map((f) => `src/${d}/${f}`))];
const report = { files: {}, strings: null };
for (const f of files) {
  const lines = readFileSync(join(ROOT, f), 'utf8').split('\n');
  const hits = [];
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return; // comments are not coupling
    const kinds = Object.entries(PATTERNS).filter(([, re]) => re.test(l)).map(([k]) => k);
    if (kinds.length) hits.push({ line: i + 1, kinds, text: l.trim().slice(0, 140) });
  });
  if (hits.length) report.files[f] = { lines: lines.length, hits };
}
{
  const lines = readFileSync(join(ROOT, 'src/ui/strings.js'), 'utf8').split('\n');
  const hits = [];
  lines.forEach((l, i) => { if (!/^\s*(\/\/|\*)/.test(l) && STRING_WORDS.test(l)) hits.push({ line: i + 1, text: l.trim().slice(0, 140) }); });
  report.strings = { file: 'src/ui/strings.js', lines: lines.length, hits };
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 1));
} else {
  const kinds = Object.keys(PATTERNS);
  console.log(`| File | Lines | Lines with a RISC-V reference | ${kinds.join(' | ')} |`);
  console.log(`|---|---:|---:|${kinds.map(() => '---:').join('|')}|`);
  for (const [f, r] of Object.entries(report.files)) {
    const n = (k) => r.hits.filter((h) => h.kinds.includes(k)).length;
    console.log(`| \`${f}\` | ${r.lines} | ${r.hits.length} | ${kinds.map(n).join(' | ')} |`);
  }
  console.log(`| \`${report.strings.file}\` | ${report.strings.lines} | ${report.strings.hits.length} (interface text) | ${kinds.map(() => '').join(' | ')} |`);
  if (process.argv.includes('--lines')) {
    for (const [f, r] of Object.entries(report.files)) {
      console.log(`\n${f}`);
      for (const h of r.hits) console.log(`  ${h.line} [${h.kinds.join(',')}] ${h.text}`);
    }
  }
}

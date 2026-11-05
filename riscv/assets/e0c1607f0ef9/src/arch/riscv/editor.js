// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { INSTRUCTIONS, ABI_NAMES } from '../../isa/encoding.js';
import { PSEUDOS, DIRECTIVES, usage } from '../../asm/assembler.js';
import { RISCV_STRINGS as RV } from './strings.js';
const REG_IDS = ABI_NAMES.map((_, i) => `x${i}`);
const REGS = [...ABI_NAMES.map((n, i) => ({ name: n, x: i })), { name: 'fp', x: 8 }, ...REG_IDS.map((name, i) => ({ name, x: i }))];
const role = (abi) => {
 const R = RV.assist.regRoles;
 return R[abi] ?? R[abi[0]] ?? '';
};
function detail(word, kind) {
 if (kind === 'mnemonic') return usage(word) ?? word;
 const r = REGS.find((x) => x.name === word);
 if (!r) return '';
 const abi = ABI_NAMES[r.x];
 const rl = role(word === 'fp' ? 'fp' : abi);
 return `${word.startsWith('x') ? abi : `x${r.x}`}${rl ? `, ${rl}` : ''}`;
}
function help(word) {
 if (INSTRUCTIONS[word]) {
 return { kind: 'instruction', usage: usage(word), format: RV.assist.format(INSTRUCTIONS[word].fmt), operation: RV.semantics[word] ?? '' };
 }
 if (PSEUDOS.includes(word)) return { kind: 'pseudo', usage: usage(word), operation: RV.pseudoSemantics[word] ?? '' };
 const r = REGS.find((x) => x.name === word);
 if (!r) return null;
 const abi = ABI_NAMES[r.x];
 const rl = role(word === 'fp' ? 'fp' : abi);
 return { kind: 'register', text: `${word === abi ? `${abi} = x${r.x}` : word === 'fp' ? 'fp = s0 = x8' : `x${r.x} = ${abi}`}${rl ? `: ${rl}` : ''}` };
}
export const editor = {
 mnemonics: [...Object.keys(INSTRUCTIONS), ...PSEUDOS].sort(),
 registers: REGS.map((r) => r.name),
 directives: [...DIRECTIVES],
 help, detail,
};

// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { assemble as rvAssemble, usage, hexImage, PSEUDOS, DIRECTIVES } from '../../../asm/assembler.js';
import { readWords } from '../../../asm/disassembler.js';
import { ABI_NAMES, INSTRUCTIONS } from '../../../isa/encoding.js';
import { decode, disassemble, ASM_CUSTOM, CSRS, IMEM_WORDS, DMEM_WORDS, WARP_OPS } from './isa.js';
import { MACHINES } from './engine.js';
import { RVSIMT_STRINGS as S } from './strings.js';
const machineOf = (profile) => ({ id: MACHINES[profile] ? profile : 'lab', chapter: null, processor: 'SIMT core', isa: null,
 textBase: 0, dataBase: 0, stackTop: null, memory: 'harvard', words: IMEM_WORDS, dataWords: DMEM_WORDS });
export function assemble(files, { profile = 'lab' } = {}) {
 const machine = machineOf(profile);
 const p = rvAssemble(files, { custom: { ...ASM_CUSTOM, machine } });
 const at = (e) => ({ severity: 'error', file: e.file, line: e.line, column: e.column, ...(e.length !== undefined ? { length: e.length } : {}) });
 p.diagnostics = p.errors.map((e) => ({ ...at(e), message: e.message, ...(e.mnemonic && usage(e.mnemonic) ? { note: `${e.mnemonic} ${usage(e.mnemonic)}` } : {}) }));
 for (const row of p.listing) {
 row.size = 4; row.text ??= '';
 if (!decode(row.word).op) {
 p.diagnostics.push({ severity: 'error', kind: 'profile', file: row.file, line: row.line, column: 1,
 message: S.asm.outside(disassemble(row.word, row.address)), note: S.asm.outsideNote });
 }
 }
 const outside = p.diagnostics.some((x) => x.kind === 'profile');
 p.data = p.dataListing;
 p.assembled = p.ok;
 p.ok = p.ok && !outside;
 p.symbols = Object.fromEntries(p.symbols);
 p.profile = machine.id;
 return p;
}
export function loadImage(content, kind, name, { profile = 'lab' } = {}) {
 const words = readWords(content, kind);
 const diagnostics = words.length > IMEM_WORDS
 ? [{ severity: 'error', file: name, line: IMEM_WORDS + 1, column: 1, message: `The image has ${words.length} words; the instruction memory holds ${IMEM_WORDS}.` }] : [];
 const w = words.slice(0, IMEM_WORDS);
 const bytes = new Uint8Array(w.length * 4);
 w.forEach((v, i) => { bytes[4 * i] = v & 0xff; bytes[4 * i + 1] = (v >>> 8) & 0xff; bytes[4 * i + 2] = (v >>> 16) & 0xff; bytes[4 * i + 3] = v >>> 24; });
 return { ok: !diagnostics.length, assembled: true, diagnostics, imported: true, profile: MACHINES[profile] ? profile : 'lab',
 segments: [{ address: 0, bytes, executable: true }], entry: 0, symbols: {},
 listing: w.map((word, i) => ({ address: 4 * i, word, size: 4, text: disassemble(word, 4 * i), part: -1 })) };
}
export const image = (program) => ({ hex: hexImage(program), bin: program.segments[0].bytes });
const R_FIELDS = (w) => [['funct7', 31, 25], ['rs2', 24, 20], ['rs1', 19, 15], ['funct3', 14, 12], ['rd', 11, 7], ['opcode', 6, 0]]
 .map(([name, hi, lo]) => ({ name, bits: `${hi}:${lo}`, value: (w >>> lo) & ((1 << (hi - lo + 1)) - 1), short: name === 'funct3' ? 'f3' : name }));
export function fieldsWith(rvFields) {
 return (word, address) => {
 const d = decode(word);
 if (d.op && WARP_OPS.includes(d.op)) {
 return R_FIELDS(word).map((f) => ({ ...f, meaning: f.name === 'funct3' ? d.op : f.name === 'opcode' ? 'custom-0' : (f.name === 'rs1' || f.name === 'rs2') ? `x${f.value} (${ABI_NAMES[f.value]})` : '' }));
 }
 return rvFields(word, address);
 };
}
const OUTSIDE = new Set(['auipc', 'jalr', 'lb', 'lh', 'lbu', 'lhu', 'sb', 'sh', 'fence', 'fence.i', 'ecall', 'ebreak', 'mret', 'wfi',
 'csrrw', 'csrrc', 'csrrwi', 'csrrsi', 'csrrci', 'csrw', 'csrs', 'csrc', 'csrwi', 'csrsi', 'csrci', 'ret', 'jr', 'call', 'tail',
 'mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu', 'halt']);
export const editor = {
 mnemonics: [...Object.keys(INSTRUCTIONS), ...PSEUDOS].filter((m) => !OUTSIDE.has(m)).concat(WARP_OPS).sort(),
 registers: [...ABI_NAMES, ...Array.from({ length: 32 }, (_, i) => `x${i}`)],
 directives: [...DIRECTIVES, '.include'].sort(),
 help: (word) => {
 const w = word.toLowerCase();
 const h = S.editorHelp[w];
 if (h) return { kind: 'instruction', usage: h.usage, format: S.customFormat, operation: h.operation };
 if (OUTSIDE.has(w)) return null;
 if (Object.hasOwn(INSTRUCTIONS, w)) return { kind: 'instruction', usage: `${w} ${usage(w) ?? ''}`.trim() };
 if (PSEUDOS.includes(w)) return { kind: 'pseudo', usage: `${w} ${usage(w) ?? ''}`.trim() };
 return null;
 },
};
export const CSR_NAMES = Object.freeze(Object.values(CSRS));

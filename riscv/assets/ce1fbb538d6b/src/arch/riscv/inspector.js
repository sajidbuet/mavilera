// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el, hex8 } from '../../ui/dom.js';
import { FORMAT_FIELDS, INSTRUCTIONS, ABI_NAMES, OPCODE, bits } from '../../isa/encoding.js';
import { disassemble } from '../../asm/disassembler.js';
import { immediateSteps } from './immediate.js';
function operandOf(syntax, field, nops) {
 const f = field.startsWith('imm') ? 'imm' : field;
 const maps = {
 'rd,rs1,rs2': { rd: 0, rs1: 1, rs2: 2 },
 'rd,rs1,imm': { rd: 0, rs1: 1, imm: 2 },
 'rd,rs1,shamt': { rd: 0, rs1: 1, rs2: 2 },
 'rd,mem': { rd: 0, rs1: 1, imm: 1 },
 'rs2,mem': { rs2: 0, rs1: 1, imm: 1 },
 'rs1,rs2,target': { rs1: 0, rs2: 1, imm: 2 },
 'rd,imm20': { rd: 0, imm: 1 },
 'rd,target': { rd: 0, imm: 1 },
 jalr: nops === 3 ? { rd: 0, rs1: 1, imm: 2 } : { rd: 0, rs1: 1, imm: 1 },
 };
 return maps[syntax]?.[f] ?? null;
}
class FieldsPanel {
 constructor(STRINGS) {
 this.S = STRINGS;
 this.root = el('div.fields', {}, el('p.note', { text: STRINGS.fieldsNone }));
 }
 show(l) {
 const STRINGS = this.S;
 if (!l || !INSTRUCTIONS[l.mnemonic]) { this.root.replaceChildren(el('p.note', { text: STRINGS.fieldsNone })); return; }
 const d = INSTRUCTIONS[l.mnemonic];
 const fmt = d.fmt;
 const real = l.source === l.mnemonic && l.parts === 1;
 const srcLine = l.text.replace(/\t/g, ' ');
 const srcBox = el('div.fields-src.mono', {}, srcLine);
 const highlight = (k) => {
 if (k === null || !real || !l.operands[k]) { srcBox.textContent = srcLine; return; }
 const { col, text } = l.operands[k];
 srcBox.replaceChildren(srcLine.slice(0, col), el('mark', { text: srcLine.slice(col, col + text.length) }),
 srcLine.slice(col + text.length));
 };
 const boxes = FORMAT_FIELDS[fmt].map(([name, hi, lo]) => {
 const v = bits(l.word, hi, lo);
 const k = operandOf(d.syntax, name, l.operands.length);
 const role = name.startsWith('imm') ? 'imm' : name;
 return el(`div.fbox.f-${role}`, { style: `flex-grow:${hi - lo + 1}`, tabindex: 0,
 onmouseenter: () => highlight(k), onmouseleave: () => highlight(null), onfocus: () => highlight(k),
 onblur: () => highlight(null) },
 el('div.fbox-bits', {}, el('span', { text: String(hi) }), el('span', { text: hi === lo ? '' : String(lo) })),
 el('div.fbox-name', { text: name }),
 el('div.fbox-val.mono', { text: v.toString(2).padStart(hi - lo + 1, '0') }),
 el('div.fbox-dec', { text: `= ${v}` }),
 el('div.fbox-width', { text: `${hi - lo + 1} ${STRINGS.fieldBits}` }));
 });
 const imm = immediateSteps(l.word, fmt);
 const I = STRINGS.inspector;
 const reg = (n) => `x${n} (${ABI_NAMES[n]})`;
 const has = (f) => FORMAT_FIELDS[fmt].some(([name]) => name === f);
 const opName = Object.entries(OPCODE).find(([, v]) => v === (l.word & 0x7f))?.[0] ?? '';
 const decoded = [
 [I.opcode, `${bits(l.word, 6, 0).toString(2).padStart(7, '0')}${opName ? ` (${opName})` : ''}`, 'opcode'],
 has('rd') && ['rd', reg(bits(l.word, 11, 7)), 'rd'],
 has('rs1') && ['rs1', reg(bits(l.word, 19, 15)), 'rs1'],
 has('rs2') && (d.syntax === 'rd,rs1,shamt' ? ['shamt', String(bits(l.word, 24, 20)), 'rs2'] : ['rs2', reg(bits(l.word, 24, 20)), 'rs2']),
 has('funct3') && ['funct3', bits(l.word, 14, 12).toString(2).padStart(3, '0'), 'funct3'],
 has('funct7') && ['funct7', bits(l.word, 31, 25).toString(2).padStart(7, '0'), 'funct7'],
 imm && [STRINGS.immediate, `${imm[1]} (${hex8(imm[1])})`, 'imm'],
 ].filter(Boolean);
 this.root.replaceChildren(
 el('div.insp-head', {}, el('span.insp-asm.mono', { text: disassemble(l.word, l.address) }),
 el('span.insp-type', { text: `${I.type(fmt)}${opName ? ` · ${opName}` : ''}` }),
 el('span.insp-addr.mono', { text: `${hex8(l.address)} · ${l.word.toString(16).padStart(8, '0')}` })),
 srcBox,
 el('div.fbox-row', { role: 'group', 'aria-label': I.fieldsCaption }, boxes),
 el('dl.insp-decoded', { 'aria-label': I.decoded }, decoded.map(([k, v, role]) => el(`div.f-${role}`, {}, el('dt', { text: k }), el('dd.mono', { text: v })))),
 STRINGS.semantics[l.mnemonic] && el('p.insp-sem', {}, el('strong', { text: `${I.semantics}: ` }), el('span.mono', { text: STRINGS.semantics[l.mnemonic] })),
 imm && el('div.imm', {}, el('strong', { text: `${STRINGS.immediate}: ` }),
 el('ol.imm-steps.mono', {}, imm[0].map((s) => el('li', { text: s })),
 el('li', { text: `${STRINGS.immSigned}: ${imm[1]} (${hex8(imm[1])})` }))));
 }
}
export function create({ strings }) {
 return new FieldsPanel(strings);
}

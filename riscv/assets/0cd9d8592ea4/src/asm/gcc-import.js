// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { startup, routines } from '../cc/runtime.js';
const IGNORED = new Set(['.globl', '.global', '.type', '.size', '.file', '.option', '.ident', '.attribute']);
const DROPPED = /^\.(cfi_\w+|loc|local|weak|hidden|protected|addrsig\w*|uleb128|sleb128|file\s+\d)\b/;
const OTHER_SECTION = /^\.(debug\w*|note\b|note\.|comment\b|riscv\.attributes)/;
const RO_DATA = /^\.(s?rodata|s?data|s?bss|tbss|tdata)(\.|$)/;
const PROVIDED = ['__mulsi3', '__udivsi3', '__umodsi3', '__divsi3', '__modsi3', 'putchar', 'exit'];
const comment = (line, why) => `# [import: ${why}] ${line.trim()}`;
export function importGcc(source) {
 const lines = source.split(/\r\n|\r|\n/);
 const out = [];
 const report = [];
 const comm = [];
 let skipping = false;
 const defined = new Set();
 const called = new Set();
 lines.forEach((raw, i) => {
 const n = i + 1;
 const code = raw.replace(/#.*$/, '').trim();
 const label = /^([A-Za-z_.$][\w.$]*):/.exec(code);
 if (label) defined.add(label[1]);
 const dir = /^(\.[\w.]+)\s*(.*)$/.exec(code);
 const section = dir && (dir[1] === '.section' ? dir[2].split(',')[0].trim() : ['.text', '.data', '.bss', '.rodata', '.sdata', '.sbss'].includes(dir[1]) ? dir[1] : null);
 if (section !== null && section !== undefined) {
 if (OTHER_SECTION.test(section)) {
 skipping = true;
 out.push(comment(raw, 'section not part of the program'));
 report.push({ line: n, what: section, action: 'skipped' });
 return;
 }
 skipping = false;
 if (section.startsWith('.text')) {
 out.push(section === '.text' && dir[1] === '.text' ? raw : `        .text   # ${raw.trim()}`);
 if (section !== '.text') report.push({ line: n, what: section, action: 'text' });
 return;
 }
 if (RO_DATA.test(section)) {
 out.push(dir[1] === section ? raw : `        .data   # ${raw.trim()}`);
 if (/rodata/.test(section)) report.push({ line: n, what: section, action: 'rodata' });
 return;
 }
 out.push(comment(raw, 'unknown section'));
 report.push({ line: n, what: section, action: 'unknown' });
 skipping = true;
 return;
 }
 if (skipping) { out.push(comment(raw, 'section not part of the program')); return; }
 if (!dir) {
 const call = /^(call|tail|jal)\s+(?:ra\s*,\s*)?([A-Za-z_.$][\w.$]*)(?:@plt)?\s*$/.exec(code);
 if (call) {
 called.add(call[2]);
 if (/@plt/.test(code)) { out.push(raw.replace('@plt', '')); report.push({ line: n, what: '@plt', action: 'plt' }); return; }
 }
 if (/%pcrel_|%got_pcrel|%tprel/.test(code)) report.push({ line: n, what: code, action: 'pcrel' });
 out.push(raw);
 return;
 }
 const [, d, rest] = dir;
 if (IGNORED.has(d) && !/^\.file\s+\d/.test(code)) { out.push(raw); return; }
 if (DROPPED.test(code)) {
 out.push(comment(raw, 'no effect here'));
 report.push({ line: n, what: d, action: 'dropped' });
 return;
 }
 if (d === '.set' || d === '.equ') {
 const m = /^([A-Za-z_.$][\w.$]*)\s*,\s*\.\s*(?:\+\s*0)?$/.exec(rest);
 if (m) {
 out.push(`${m[1]}:   # ${raw.trim()}`);
 defined.add(m[1]);
 report.push({ line: n, what: `${d} ${m[1]}`, action: 'label' });
 return;
 }
 out.push(raw);
 return;
 }
 if (d === '.comm' || d === '.lcomm') {
 const [name, size, align] = rest.split(',').map((x) => x.trim());
 comm.push({ name, size: Number(size), align: Number(align || 4) });
 defined.add(name);
 out.push(comment(raw, 'space added at the end'));
 report.push({ line: n, what: `${d} ${name}`, action: 'comm' });
 return;
 }
 if (d === '.dword' || d === '.quad' || d === '.8byte' || d === '.float' || d === '.double') {
 report.push({ line: n, what: d, action: 'unsupported' });
 }
 out.push(raw);
 });
 const tail = ['', '# ---- added by the import (MAVILERA): start-up code'];
 tail.push('        .text', ...startup({ profile: 'iss' }));
 if (comm.length) {
 tail.push('', '# ---- added by the import: the space of the .comm symbols', '        .data');
 for (const c of comm) tail.push(`        .balign ${c.align}`, `${c.name}: .zero  ${c.size}`);
 }
 const need = [...called].filter((s) => !defined.has(s));
 const added = need.filter((s) => PROVIDED.includes(s));
 if (added.length) tail.push('', '# ---- added by the import: helper routines that the program calls', '        .text', ...routines(added, { profile: 'iss', m: true }));
 const missing = need.filter((s) => !PROVIDED.includes(s));
 return { text: `${[...out, ...tail].join('\n')}\n`, report, added, missing };
}
export function looksLikeGcc(text) {
 return /^\s*\.(file\s+"|ident\s+"GCC|attribute\s+arch)/m.test(text);
}

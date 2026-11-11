// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Hart, SimError, traceRecord } from './iss.js';
import { disassemble } from '../asm/disassembler.js';
import { recordFrames as shellRecordFrames, vcd as shellVcd } from '../shell/vcd.js';
const hex = (v) => (v >>> 0).toString(16).padStart(8, '0');
const h8 = (v) => `0x${hex(v)}`;
export function goldenText(words) {
 return words.map((w) => `${hex(w)}\n`).join('');
}
export function traceRecords(program, profile, count, options = {}) {
 const hart = new Hart(program, { profile, ...options });
 const records = [];
 let error = null;
 try {
 while (records.length < count && !hart.halted) {
 const rec = hart.step();
 if (rec && rec.cls) records.push(rec);
 }
 } catch (e) {
 if (!(e instanceof SimError)) throw e;
 error = e.message;
 }
 return { records, error };
}
export function traceJsonLines(records) {
 return records.map((r) => `${JSON.stringify(traceRecord(r))}\n`).join('');
}
export function traceCsv(records) {
 const rows = ['step,pc,word,instruction,rd,rd_value,mem_addr,mem_size,mem_value'];
 records.forEach((r, i) => {
 rows.push([
 i + 1, h8(r.pc), h8(r.word), `"${disassemble(r.word, r.pc).replace(/"/g, '""')}"`,
 r.reg ? `x${r.reg.rd}` : '', r.reg ? h8(r.reg.value) : '',
 r.mem ? h8(r.mem.addr) : '', r.mem ? r.mem.size : '', r.mem ? h8(r.mem.value) : '',
 ].join(','));
 });
 return `${rows.join('\n')}\n`;
}
export const recordFrames = shellRecordFrames;
export const vcd = shellVcd;

// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { LineTable, ROW_STMT, ROW_END } from './dwarf-line.js';
export const ccPath = (name) => `/mavilera-c/${name}`;
export function ccDebug(program, source) {
 const asmFile = program.listing.find((r) => r.file)?.file ?? null;
 const addr = [], fil = [], lin = [], col = [], flg = [];
 let prevLine = 0, end = -1;
 const close = () => { if (end >= 0) { addr.push(end); fil.push(0); lin.push(prevLine); col.push(0); flg.push(ROW_END); } end = -1; prevLine = 0; };
 for (const r of program.listing) {
 const c = r.file === asmFile ? source.lines[r.line - 1] ?? 0 : 0;
 if (!c) { close(); continue; }
 if (end !== r.address) close();
 if (c !== prevLine) { addr.push(r.address >>> 0); fil.push(0); lin.push(c); col.push(0); flg.push(ROW_STMT); prevLine = c; }
 end = (r.address + r.size) >>> 0;
 }
 close();
 const lineTable = new LineTable([ccPath(source.file)], addr, fil, lin, col, flg, 1);
 const code = program.listing;
 const codeEnd = code.length ? (code[code.length - 1].address + code[code.length - 1].size) >>> 0 : 0;
 const lo = code.length ? code[0].address >>> 0 : 0;
 const labels = Object.entries(program.symbols ?? {}).filter(([n, a]) => !n.startsWith('.') && a >>> 0 >= lo && a >>> 0 < codeEnd)
 .map(([name, a]) => ({ name, address: a >>> 0 })).sort((x, y) => x.address - y.address || x.name.localeCompare(y.name));
 const functions = [];
 labels.forEach((f, i) => {
 if (i + 1 < labels.length && labels[i + 1].address === f.address) return;
 const next = labels.slice(i + 1).find((g) => g.address > f.address)?.address ?? codeEnd;
 functions.push({ name: f.name, address: f.address, size: next - f.address });
 });
 return { name: source.file, lineTable, functions, sources: new Map([[ccPath(source.file), source.text]]) };
}

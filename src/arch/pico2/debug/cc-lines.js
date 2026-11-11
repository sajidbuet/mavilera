// cc-lines.js -- the C source view for programs in MAVILERA C (pico2 P1-L1, research D34; design
// docs/architecture/pico2-p1l1-lite.md §2): the program's `debug` record as firmware/import.js gives it for an ELF, built
// instead from the C compiler's line map (src/cc: the C line of each line of the generated assembly) and the assembler's
// listing. A run of consecutive instructions of one C line is one row of the line table, its first instruction the start of
// a statement; code without a C line (the start-up code, putchar and the other helper routines) has no row, as code
// without debug information has none in an ELF. Functions are the global labels of the text, each up to the next one.
// The simulator's own code (C4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { LineTable, ROW_STMT, ROW_END } from './dwarf-line.js';

/** The path the C file has in the line table and in the view's opened texts (a prefix no opened folder has). */
export const ccPath = (name) => `/mavilera-c/${name}`;

/**
 * The `debug` record of an assembled MAVILERA C program.
 * @param {object} program  the assembler's Program (listing rows {address, size, file, line}, symbols)
 * @param {{file: string, text: string, lines: number[]}} source  the C file, its text and the compiler's map
 *   (lines[k]: the C line of line k + 1 of the generated assembly, 0 for none)
 * @returns {{name: string, lineTable: LineTable, functions: {name, address, size}[], sources: Map<string, string>}}
 */
export function ccDebug(program, source) {
  const asmFile = program.listing.find((r) => r.file)?.file ?? null; // the generated assembly is the program's one file
  const addr = [], fil = [], lin = [], col = [], flg = [];
  let prevLine = 0, end = -1;
  const close = () => { if (end >= 0) { addr.push(end); fil.push(0); lin.push(prevLine); col.push(0); flg.push(ROW_END); } end = -1; prevLine = 0; };
  for (const r of program.listing) {
    const c = r.file === asmFile ? source.lines[r.line - 1] ?? 0 : 0;
    if (!c) { close(); continue; }
    if (end !== r.address) close(); // not contiguous (data between, or another section): a new sequence
    if (c !== prevLine) { addr.push(r.address >>> 0); fil.push(0); lin.push(c); col.push(0); flg.push(ROW_STMT); prevLine = c; }
    end = (r.address + r.size) >>> 0;
  }
  close();
  const lineTable = new LineTable([ccPath(source.file)], addr, fil, lin, col, flg, 1);

  // functions: the global text labels (no '.' locals), each up to the next, the last up to the end of the code
  const code = program.listing;
  const codeEnd = code.length ? (code[code.length - 1].address + code[code.length - 1].size) >>> 0 : 0;
  const lo = code.length ? code[0].address >>> 0 : 0;
  const labels = Object.entries(program.symbols ?? {}).filter(([n, a]) => !n.startsWith('.') && a >>> 0 >= lo && a >>> 0 < codeEnd)
    .map(([name, a]) => ({ name, address: a >>> 0 })).sort((x, y) => x.address - y.address || x.name.localeCompare(y.name));
  const functions = [];
  labels.forEach((f, i) => {
    if (i + 1 < labels.length && labels[i + 1].address === f.address) return; // two names at one address: the later one
    const next = labels.slice(i + 1).find((g) => g.address > f.address)?.address ?? codeEnd;
    functions.push({ name: f.name, address: f.address, size: next - f.address });
  });
  return { name: source.file, lineTable, functions, sources: new Map([[ccPath(source.file), source.text]]) };
}

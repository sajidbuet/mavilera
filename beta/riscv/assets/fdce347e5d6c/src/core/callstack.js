// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export function textNamer(program) {
 const labels = (program?.symbolTable ?? []).filter((s) => s.section === 'text').sort((a, b) => a.address - b.address);
 return (addr) => {
 let best = null;
 for (const s of labels) {
 if (s.address > addr) break;
 best = s;
 }
 if (!best) return null;
 const off = addr - best.address;
 return off ? `${best.name}+0x${off.toString(16)}` : best.name;
 };
}
export function callStack(hart, program) {
 if (!hart) return [];
 const name = textNamer(program);
 const out = [];
 for (let f = hart.abiTop; f; f = f.parent) {
 out.push({ depth: f.depth, target: f.target, name: name(f.target), call: f.call, site: name(f.call), ret: f.ret,
 sp: f.sp ?? null, args: f.args ? Array.from(f.args) : [] });
 }
 return out;
}

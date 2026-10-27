// callstack.js -- the call stack of the ISA view (WS-F-103, WS-F-143), from
// the --abi-check frames of the hart (iss.js): a call is a jal or jalr that
// writes ra, and it ends at the jalr x0 that returns to the address after it,
// as rvsim.py --abi-check sees calls. Each frame names the procedure by the
// label at its entry and the call site by the nearest label before it, and
// keeps a0-a7 as they were at the call. The simulator does not know how many
// arguments a procedure takes, so all eight registers are given. Pure
// JavaScript, no DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/** A function giving `label` or `label+0x10` for a text address (null: no label at or before it). */
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

/**
 * The frames of the calls in progress, innermost first:
 * {depth, target, name, call, site, ret, sp, args: number[8]}.
 */
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

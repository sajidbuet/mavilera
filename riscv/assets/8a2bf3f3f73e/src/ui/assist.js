// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function completionContext(before, comment = '#') {
 if (new RegExp(esc(comment)).test(before.replace(/"(?:\\.|[^"])*"|'(?:\\.|[^'])'/g, '')) || /"[^"]*$/.test(before)) return null;
 const head = /^(\s*(?:[A-Za-z_.$][\w.$]*:\s*)*)([A-Za-z][\w.]*)$/.exec(before);
 if (head) return { kind: 'mnemonic', prefix: head[2], from: head[1].length };
 const op = /^\s*(?:[A-Za-z_.$][\w.$]*:\s*)*[A-Za-z][\w.]*\s+.*?(?:^|[\s,(])([A-Za-z][\w]*)$/.exec(before);
 if (op && !/^\s*(?:[A-Za-z_.$][\w.$]*:\s*)*\./.test(before)) return { kind: 'register', prefix: op[1], from: before.length - op[1].length };
 return null;
}
export function completions(ctx, E, limit = 8) {
 if (!ctx || !ctx.prefix) return [];
 const p = ctx.prefix.toLowerCase();
 const words = ctx.kind === 'mnemonic' ? E.mnemonics : E.registers;
 return words.filter((w) => w.startsWith(p) && w !== p).slice(0, limit).map((w) => ({ label: w, detail: E.detail?.(w, ctx.kind) ?? '' }));
}
export function isComplete(ctx, E) {
 if (!ctx?.prefix) return false;
 const p = ctx.prefix.toLowerCase();
 return (ctx.kind === 'mnemonic' ? E.mnemonics : E.registers).includes(p);
}
export function wordAt(line, col) {
 const re = /[A-Za-z_.$][\w.$]*/g;
 for (const m of line.matchAll(re)) {
 if (col >= m.index && col < m.index + m[0].length) return { word: m[0], from: m.index, to: m.index + m[0].length };
 }
 return null;
}
export function helpFor(line, col, E, comment = '#') {
 const w = wordAt(line, col);
 if (!w || !E.help) return null;
 const c = line.indexOf(comment);
 if (c >= 0 && c < w.from) return null;
 const word = w.word.toLowerCase();
 const h = E.help(word);
 return h ? { ...h, word } : null;
}

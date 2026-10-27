// programs-c.mjs -- generated C-subset programs for the compiler tests
// (WS-V-030; used by cc.test.mjs, contains no tests). Deterministic for a
// seed. Each program computes a checksum of everything it does and returns
// it from main, so the exit code is the observable result. Undefined
// behaviour is avoided by construction: divisors are 1 to 16, shift counts
// are masked to 0-31, side effects occur only in statements, loops have
// fixed trip counts, and every variable is initialised. The functions other
// than main have no side effects (they write only their own locals), so the
// unspecified order in which C evaluates operands and arguments cannot
// change the result. Signed overflow wraps (GCC at -O0 and the simulator's
// compiler).
// `words`: only 32-bit types, for the processors of Chapters 6-8.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

function prng(seed) { // xorshift32
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}

const ALL_TYPES = ['int', 'unsigned', 'int32_t', 'uint32_t', 'char', 'uint8_t', 'int8_t', 'short', 'uint16_t', 'int16_t', '_Bool'];
const WORD_TYPES = ['int', 'unsigned', 'int32_t', 'uint32_t'];

export function cProgram(seed, { words = false, functions = 3, statements = 6 } = {}) {
  const rnd = prng(seed);
  const pick = (a) => a[rnd() % a.length];
  const chance = (n) => rnd() % 100 < n;
  const TYPES = words ? WORD_TYPES : ALL_TYPES;
  const small = () => String(rnd() % 100);
  const lit = () => {
    const k = rnd() % 4;
    if (k === 0) return `0x${(rnd() >>> 0).toString(16)}u`;
    if (k === 1) return String(rnd() % 2000 - 1000).replace(/^-/, '-');
    return small();
  };
  const lines = ['#include <stdint.h>', ''];
  // globals: arrays of 8 (index masked with & 7) and scalars
  const garrays = [];
  for (let k = 0; k < 3; k++) {
    const t = pick(TYPES.filter((x) => x !== '_Bool'));
    const name = `ga${k}`;
    const init = Array.from({ length: 8 }, () => lit()).join(', ');
    lines.push(`${chance(50) ? 'static ' : ''}${t} ${name}[8] = { ${init} };`);
    garrays.push({ name, t });
  }
  const gvars = [];
  for (let k = 0; k < 3; k++) {
    const t = pick(TYPES);
    lines.push(`${t} gv${k} = ${lit()};`);
    gvars.push({ name: `gv${k}`, t });
  }
  lines.push('uint32_t sum = 2166136261u;', '');
  lines.push('static void mix(uint32_t v)', '{', '    sum = (sum ^ v) * 16777619u;', '}', '');
  lines.push('static int rec(int n, int a)', '{', '    if (n <= 0)', '        return a;', '    return rec(n - 1, a * 3 + n) ^ n;', '}', '');

  const funcs = [];
  let depthLimit = 3;
  function expr(vars, depth) {
    const k = rnd() % (depth >= depthLimit ? 3 : 14);
    const v = () => pick(vars).name;
    switch (k) {
      case 0: return lit();
      case 1: case 2: return v();
      case 3: { const a = pick(garrays); return `${a.name}[(${expr(vars, depth + 1)}) & 7]`; }
      case 4: return `(${expr(vars, depth + 1)} ${pick(['+', '-', '*', '&', '|', '^'])} ${expr(vars, depth + 1)})`;
      case 5: return `(${expr(vars, depth + 1)} ${pick(['/', '%'])} ((${expr(vars, depth + 1)} & 15) + 1))`;
      case 6: return `(${expr(vars, depth + 1)} ${pick(['<<', '>>'])} (${expr(vars, depth + 1)} & 31))`;
      case 7: return `(${expr(vars, depth + 1)} ${pick(['<', '>', '<=', '>=', '==', '!='])} ${expr(vars, depth + 1)})`;
      case 8: return `(${expr(vars, depth + 1)} ${pick(['&&', '||'])} ${expr(vars, depth + 1)})`;
      case 9: return `${pick(['-', '~', '!'])}(${expr(vars, depth + 1)})`;
      case 10: return `(${expr(vars, depth + 1)} ? ${expr(vars, depth + 1)} : ${expr(vars, depth + 1)})`;
      case 11: return `((${pick(TYPES)})(${expr(vars, depth + 1)}))`;
      case 12: {
        if (!funcs.length) return v();
        const f = pick(funcs);
        return `${f.name}(${f.params.map(() => expr(vars, depth + 1)).join(', ')})`;
      }
      default: { const a = pick(garrays); return `*(${a.name} + ((${expr(vars, depth + 1)}) & 7))`; }
    }
  }
  let loopVar = 0;
  // pure: inside a function other than main; no global stores, the checksum goes to the local acc
  function block(vars, writable, n, depth, indent, pure = false) {
    const out = [];
    const pad = ' '.repeat(indent);
    for (let s = 0; s < n; s++) {
      let k = rnd() % (depth >= 2 ? 7 : 12);
      if (pure && (k === 4 || k === 5 || k === 6 || k === 11)) {
        out.push(`${pad}acc = acc * 31u + (uint32_t)(${expr(vars, 0)});`);
        continue;
      }
      const w = () => pick(writable);
      const sub = (m, d, ind, v = vars) => block(v, writable, m, d, ind, pure);
      switch (k) {
        case 0: case 1: out.push(`${pad}${w().name} = ${expr(vars, 0)};`); break;
        case 2: {
          const op = pick(['+=', '-=', '*=', '&=', '|=', '^=', '/=', '%=', '<<=', '>>=']);
          const r = op === '/=' || op === '%=' ? `((${expr(vars, 1)} & 15) + 1)` : op === '<<=' || op === '>>=' ? `(${expr(vars, 1)} & 31)` : expr(vars, 1);
          out.push(`${pad}${w().name} ${op} ${r};`);
          break;
        }
        case 3: out.push(`${pad}${pick(['++', '--'])}${w().name};`, `${pad}${w().name}${pick(['++', '--'])};`); break;
        case 4: { const a = pick(garrays); out.push(`${pad}${a.name}[(${expr(vars, 1)}) & 7] = ${expr(vars, 0)};`); break; }
        case 5: case 6: out.push(`${pad}mix((uint32_t)(${expr(vars, 0)}));`); break;
        case 7: {
          out.push(`${pad}if (${expr(vars, 1)}) {`, ...sub(2, depth + 1, indent + 4));
          if (chance(50)) out.push(`${pad}} else {`, ...sub(2, depth + 1, indent + 4));
          out.push(`${pad}}`);
          break;
        }
        case 8: {
          const i = `i${loopVar++}`;
          const inner = [...vars, { name: i, t: 'int' }];
          out.push(`${pad}for (int ${i} = 0; ${i} < ${2 + (rnd() % 5)}; ${i}++) {`, ...sub(2, depth + 1, indent + 4, inner));
          if (chance(30)) out.push(`${pad}    if (${expr(inner, 1)}) ${pick(['break', 'continue'])};`);
          out.push(`${pad}}`);
          break;
        }
        case 9: {
          const c = `c${loopVar++}`;
          out.push(`${pad}int ${c} = ${1 + (rnd() % 4)};`);
          if (chance(50)) out.push(`${pad}while (${c} > 0) {`, ...sub(2, depth + 1, indent + 4), `${pad}    ${c}--;`, `${pad}}`);
          else out.push(`${pad}do {`, ...sub(2, depth + 1, indent + 4), `${pad}    ${c}--;`, `${pad}} while (${c} > 0);`);
          break;
        }
        case 10: {
          out.push(`${pad}switch ((${expr(vars, 1)}) & 3) {`);
          for (let c = 0; c < 3; c++) {
            out.push(`${pad}case ${c}: {`, ...sub(1, depth + 1, indent + 4));
            out.push(chance(70) ? `${pad}    break;` : `${pad}    /* falls through */`, `${pad}}`);
          }
          out.push(`${pad}default: {`, ...sub(1, depth + 1, indent + 4), `${pad}}`, `${pad}}`);
          break;
        }
        default: out.push(`${pad}mix((uint32_t)rec(${rnd() % 5}, ${expr(vars, 1)}));`);
      }
    }
    return out;
  }

  for (let f = 0; f < functions; f++) {
    const nParams = 1 + (rnd() % 4);
    const params = Array.from({ length: nParams }, (_, k) => ({ name: `p${k}`, t: pick(TYPES) }));
    const ret = pick(TYPES.filter((x) => x !== '_Bool'));
    const locals = Array.from({ length: 2 + (rnd() % 3) }, (_, k) => ({ name: `v${k}`, t: pick(TYPES) }));
    const name = `f${f}`;
    lines.push(`static ${ret} ${name}(${params.map((p) => `${p.t} ${p.name}`).join(', ')})`, '{');
    const scope = [...params, ...gvars];
    lines.push('    uint32_t acc = 0;');
    for (const l of locals) { lines.push(`    ${l.t} ${l.name} = ${expr(scope, 1)};`); scope.push(l); }
    if (chance(40)) {
      lines.push('    int arr[4] = { 1, 2, 3 };', '    int *q = arr;');
      lines.push(`    q[(${expr(scope, 2)}) & 3] = ${expr(scope, 1)};`, `    *(q + 1) += ${expr(scope, 2)};`);
      lines.push('    acc += (uint32_t)(arr[0] + arr[1] * 3 + arr[2] * 5 + arr[3] * 7);');
    }
    depthLimit = 2;
    lines.push(...block(scope, [...locals, ...params], statements, 0, 4, true));
    lines.push(`    return (${ret})(acc ^ (uint32_t)(${expr(scope, 1)}));`, '}', '');
    funcs.push({ name, params });
  }
  lines.push('int main(void)', '{');
  const scope = [...gvars];
  depthLimit = 3;
  for (let k = 0; k < 2; k++) { lines.push(`    int m${k} = ${expr(scope, 1)};`); scope.push({ name: `m${k}`, t: 'int' }); }
  lines.push(...block(scope, scope.filter((x) => x.name.startsWith('m') || x.name.startsWith('gv')), statements, 0, 4));
  for (const g of [...garrays]) lines.push(`    for (int k = 0; k < 8; k++)`, `        mix((uint32_t)${g.name}[k]);`);
  for (const g of gvars) lines.push(`    mix((uint32_t)${g.name});`);
  lines.push('    return (int)sum;', '}', '');
  return lines.join('\n');
}

// codegen.js -- RISC-V assembly from a checked C-subset program (spec §10.1,
// WS-F-080 to WS-F-083). One statement at a time, no optimisation besides
// computing integer constant expressions at compile time:
//   plain mode     every variable lives in the stack frame, as an
//                  unoptimised compiler does and as Chapter 4 explains;
//   register mode  scalar locals and parameters whose address is never
//                  taken (and that are not volatile) live in s1-s11, and
//                  instructions read and write them there.
// Frames follow the psABI and Chapter 4: sp moves once, by a multiple of 16;
// ra and s0 are saved at the top of the frame; s0 is the frame pointer (the
// caller's sp); locals sit below the saved registers; the bottom of the frame
// holds the temporaries saved across calls and the outgoing arguments.
// Expressions are evaluated into t0-t5 (t6 is a scratch register for large
// offsets); a register variable is read where it is. A call saves the
// temporaries in use, evaluates its arguments into the frame, loads a0-a7 and
// calls. Each output line records the C line it comes from, and comments name
// the C construct (WS-F-082).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { CError } from './lexer.js';
import { T, isInt, isPtr, sizeOf, alignOf, typeName } from './types.js';
import { valueType } from './check.js';
import { startup, routines } from './runtime.js';
import { PROFILES } from '../core/profiles.js';

const TEMPS = ['t0', 't1', 't2', 't3', 't4', 't5'];
const SREGS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11'];
const CHAPTER = { ch06: 6, ch07: 7, ch08: 8 };
const alignUp = (v, a) => Math.ceil(v / a) * a;
const log2 = (n) => Math.log2(n) | 0;
const fits12 = (v) => v >= -2048 && v <= 2047;
const isTemp = (r) => TEMPS.includes(r);
const word = (t) => sizeOf(valueType(t)) === 4 && !t.bool;
const aType = (t) => `${/^[aeiou]/.test(typeName(t)) ? 'an' : 'a'} ${typeName(t)}`;

/**
 * @param {object} prog result of check()
 * @param {{profile: string, m: boolean, lbu: boolean, mode: 'plain'|'register'}} target
 *   m: the M extension (mul, div, rem); lbu: the Chapter 6 laboratory extension
 * @param {string[]} srcLines the C source, for the comments
 * @returns {{lines: Array<{text: string, cline: number}>, routines: string[]}}
 */
export function generate(prog, target, srcLines) {
  const out = [];
  let cline = 0;
  let nLabel = 0;
  const needed = new Set(prog.builtins);
  const ch = CHAPTER[target.profile] ?? null;
  const proc = PROFILES[target.profile]?.processor ?? '';
  const newLabel = () => `.L${nLabel++}`;
  const comment = (text) => `${' '.repeat(Math.max(1, 24 - text.length))}# `;
  let fbuf = null; // the body of the function being generated
  const emit = (text) => (fbuf ?? out).push({ text, cline });
  const ins = (mn, ops = '', note = '') => emit(`        ${ops ? mn.padEnd(8) : mn}${ops}${note ? `${comment(ops)}${note}` : ''}`.trimEnd());
  const label = (l) => emit(`${l}:`);
  const err = (msg, loc, subset = false) => new CError(msg, loc, { subset });

  // --- per function ----------------------------------------------------------------------
  let free = null; // free temporaries
  let used = null; // temporaries in use, in allocation order
  let spillDepth = 0;
  let spillMax = 0;
  let loopLabels = []; // {brk, cont}
  let current = null; // {name, ret, retLabel, isMain}

  const alloc = (loc) => {
    if (!free.length) throw err('this expression needs more than six temporary registers; split it into smaller statements', loc);
    const r = free.shift();
    used.push(r);
    return r;
  };
  /** Give back a temporary; a register variable or zero is not a temporary and is left alone. */
  const release = (...rs) => {
    for (const r of rs) {
      if (!r || !used.includes(r)) continue;
      used.splice(used.indexOf(r), 1);
      free.push(r);
      free.sort((a, b) => TEMPS.indexOf(a) - TEMPS.indexOf(b));
    }
  };
  /** A register for the result of an instruction that reads r: r itself if it is a temporary. */
  const dest = (r, loc) => (isTemp(r) ? r : alloc(loc));

  /** A memory instruction base + off, through t6 when off does not fit 12 bits. */
  const mem = (mn, reg, off, base, note = '') => {
    if (fits12(off)) { ins(mn, `${reg}, ${off}(${base})`, note); return; }
    ins('li', `t6, ${off}`);
    ins('add', `t6, t6, ${base}`);
    ins(mn, `${reg}, 0(t6)`, note);
  };
  const addImm = (rd, rs, imm, note = '') => {
    if (fits12(imm)) ins('addi', `${rd}, ${rs}, ${imm}`, note);
    else { ins('li', `t6, ${imm}`); ins('add', `${rd}, ${rs}, t6`, note); }
  };

  // --- loads, stores, conversions ------------------------------------------------------------
  function loadInstr(t, loc) {
    const size = sizeOf(t);
    if (size === 4) return 'lw';
    const mn = size === 2 ? (t.signed ? 'lh' : 'lhu') : (t.signed ? 'lb' : 'lbu');
    if (ch && !(mn === 'lbu' && target.lbu)) {
      throw err(`reading ${aType(t)} needs ${mn}, which the ${proc} does not have (it has word access only${ch === 6 ? '; the lbu extension adds lbu' : ''}); use int or uint32_t`, loc);
    }
    return mn;
  }
  function storeInstr(t, loc) {
    const size = sizeOf(t);
    if (size === 4) return 'sw';
    const mn = size === 2 ? 'sh' : 'sb';
    if (ch) throw err(`writing ${aType(t)} needs ${mn}, which the ${proc} does not have (it has word access only); use int or uint32_t`, loc);
    return mn;
  }

  /**
   * The value in r, of type `from`, brought to type `to`: truncated and
   * extended in the open (WS-F-081). Returns the register that holds it.
   */
  function convert(r, from, to) {
    from = valueType(from);
    if (to.kind === 'void' || !isInt(to) || !r) return r;
    if (to.bool) {
      if (from.bool) return r;
      const d = dest(r);
      ins('snez', `${d}, ${r}`, 'to _Bool: 0 or 1');
      return d;
    }
    if (to.size === 4) return r;
    const fits = isInt(from) && (from.bool || (from.size <= to.size && (from.signed === to.signed || (!from.signed && from.size < to.size))));
    if (fits) return r;
    const d = dest(r);
    const sh = 32 - 8 * to.size;
    if (!to.signed && to.size === 1) { ins('andi', `${d}, ${r}, 255`, `to ${typeName(to)}`); return d; }
    ins('slli', `${d}, ${r}, ${sh}`, `to ${typeName(to)}`);
    ins(to.signed ? 'srai' : 'srli', `${d}, ${d}, ${sh}`);
    return d;
  }

  // --- lvalues ------------------------------------------------------------------------------
  // {k: 'reg', r, type, name} or {k: 'mem', base, off, type, tmp, name}; tmp: the base when it is a temporary
  function lvalue(e) {
    switch (e.kind) {
      case 'id': {
        const s = e.sym;
        if (s.reg) return { k: 'reg', r: s.reg, type: s.type, name: s.name };
        if (s.storage === 'local' || s.storage === 'param') return { k: 'mem', base: 's0', off: s.off, type: s.type, tmp: null, name: s.name };
        const t = alloc(e.loc);
        ins('la', `${t}, ${s.label}`, `address of ${s.name}`);
        return { k: 'mem', base: t, off: 0, type: s.type, tmp: t, name: s.name };
      }
      case 'str': {
        const t = alloc(e.loc);
        ins('la', `${t}, ${e.label}`, 'address of the string');
        return { k: 'mem', base: t, off: 0, type: e.type, tmp: t };
      }
      case 'unary': { // *p
        const r = value(e.e);
        return { k: 'mem', base: r, off: 0, type: e.type, tmp: isTemp(r) ? r : null };
      }
      case 'index': {
        const base = value(e.a);
        const i = value(e.i);
        const size = sizeOf(e.type);
        let si = i;
        if (size > 1) {
          si = dest(i, e.loc);
          ins('slli', `${si}, ${i}, ${log2(size)}`, `index × ${size} bytes`);
        }
        const d = isTemp(base) ? base : isTemp(si) ? si : alloc(e.loc);
        ins('add', `${d}, ${base}, ${si}`, 'address of the element');
        release(...[base, si, i].filter((r) => r !== d));
        return { k: 'mem', base: d, off: 0, type: e.type, tmp: d };
      }
      default: throw err('not an object in memory', e.loc);
    }
  }

  /** The object of lv in a temporary of its own (a copy of a register variable). */
  function loadCopy(lv, loc) {
    const r = alloc(loc);
    if (lv.k === 'reg') ins('mv', `${r}, ${lv.r}`, lv.name);
    else mem(loadInstr(lv.type, loc), r, lv.off, lv.base, lv.name ?? '');
    return r;
  }
  /** The object of lv for reading: a register variable where it is, else loaded (into its base temporary if it has one). */
  function read(lv, loc) {
    if (lv.k === 'reg') return lv.r;
    const r = lv.tmp ?? alloc(loc);
    mem(loadInstr(lv.type, loc), r, lv.off, lv.base, lv.name ?? '');
    return r;
  }
  function store(lv, r, loc) {
    if (lv.k === 'reg') { if (r !== lv.r) ins('mv', `${lv.r}, ${r}`, `${lv.name} = …`); return; }
    mem(storeInstr(lv.type, loc), r, lv.off, lv.base, lv.name ? `${lv.name} = …` : '');
  }
  /** The address of an object, in a temporary. */
  function address(lv, loc) {
    if (lv.k === 'reg') throw new Error('address of a register variable');
    if (lv.tmp) { if (lv.off) addImm(lv.tmp, lv.tmp, lv.off); return lv.tmp; }
    const r = alloc(loc);
    addImm(r, lv.base, lv.off, lv.name ? `address of ${lv.name}` : '');
    return r;
  }

  // --- expressions -------------------------------------------------------------------------
  /**
   * Evaluate e. Returns the register that holds its value: a temporary, which
   * the caller releases, or a register variable, which the caller only reads;
   * null for a void expression.
   */
  function value(e) {
    if (e.cv !== undefined && (isInt(e.type) || isPtr(e.type))) {
      const r = alloc(e.loc);
      ins('li', `${r}, ${e.cv | 0}`);
      return r;
    }
    switch (e.kind) {
      case 'str': return address(lvalue(e), e.loc);
      case 'id': case 'index':
        if (e.type.kind === 'array') return address(lvalue(e), e.loc);
        return read(lvalue(e), e.loc);
      case 'unary':
        if (e.op !== '*') return unary(e);
        if (e.type.kind === 'array') return address(lvalue(e), e.loc);
        return read(lvalue(e), e.loc);
      case 'cast': {
        const r = value(e.e);
        if (e.type.kind === 'void') { release(r); return null; }
        return convert(r, e.e.type, e.type);
      }
      case 'incdec': return incdec(e);
      case 'binary': return binary(e);
      case 'assign': return assign(e);
      case 'cond': return cond(e);
      case 'call': return call(e);
      default: throw err(`cannot evaluate ${e.kind}`, e.loc);
    }
  }

  function unary(e) {
    if (e.op === '&') return address(lvalue(e.e), e.loc);
    const r = value(e.e);
    if (e.op === '+') return r;
    const d = dest(r, e.loc);
    if (e.op === '-') ins('neg', `${d}, ${r}`);
    else if (e.op === '~') ins('not', `${d}, ${r}`);
    else ins('seqz', `${d}, ${r}`, '!');
    return d;
  }

  function incdec(e) {
    const lv = lvalue(e.e);
    const step = (isPtr(e.type) ? sizeOf(e.type.to) : 1) * (e.op === '++' ? 1 : -1);
    const what = e.prefix ? `${e.op}${lv.name ?? ''}` : `${lv.name ?? ''}${e.op}`;
    if (lv.k === 'reg' && word(e.type)) { // a word in a register: changed where it is
      if (e.prefix) { ins('addi', `${lv.r}, ${lv.r}, ${step}`, what); return lv.r; }
      const old = alloc(e.loc);
      ins('mv', `${old}, ${lv.r}`, 'the old value');
      ins('addi', `${lv.r}, ${lv.r}, ${step}`, what);
      return old;
    }
    const v = loadCopy(lv, e.loc);
    if (e.prefix) {
      ins('addi', `${v}, ${v}, ${step}`, what);
      const c = convert(v, T.int, e.type);
      store(lv, c, e.loc);
      release(lv.tmp);
      return c;
    }
    const n = alloc(e.loc);
    ins('addi', `${n}, ${v}, ${step}`, what);
    const c = convert(n, T.int, e.type);
    store(lv, c, e.loc);
    release(n, c, lv.tmp);
    return v;
  }

  /** d = a op b on type t (an integer type), or pointer arithmetic (scale, diff); b may be changed. */
  function arith(op, d, a, b, t, loc, { scale = 0, diff = 0 } = {}) {
    if (scale) {
      let sb = b;
      if (scale > 1) {
        sb = isTemp(b) ? b : alloc(loc);
        ins('slli', `${sb}, ${b}, ${log2(scale)}`, `× ${scale} bytes per element`);
      }
      ins(op === '+' ? 'add' : 'sub', `${d}, ${a}, ${sb}`);
      if (sb !== b) release(sb);
      return;
    }
    if (diff) {
      ins('sub', `${d}, ${a}, ${b}`);
      if (diff > 1) ins('srai', `${d}, ${d}, ${log2(diff)}`, `÷ ${diff} bytes per element`);
      return;
    }
    const s = t.signed;
    switch (op) {
      case '+': ins('add', `${d}, ${a}, ${b}`); break;
      case '-': ins('sub', `${d}, ${a}, ${b}`); break;
      case '&': ins('and', `${d}, ${a}, ${b}`); break;
      case '|': ins('or', `${d}, ${a}, ${b}`); break;
      case '^': ins('xor', `${d}, ${a}, ${b}`); break;
      case '<<': ins('sll', `${d}, ${a}, ${b}`); break;
      case '>>': ins(s ? 'sra' : 'srl', `${d}, ${a}, ${b}`, s ? 'signed: arithmetic shift' : 'unsigned: logical shift'); break;
      case '*': case '/': case '%': {
        const mn = { '*': 'mul', '/': s ? 'div' : 'divu', '%': s ? 'rem' : 'remu' }[op];
        if (target.m) { ins(mn, `${d}, ${a}, ${b}`); break; }
        const fn = { '*': '__mulsi3', '/': s ? '__divsi3' : '__udivsi3', '%': s ? '__modsi3' : '__umodsi3' }[op];
        callRoutine(fn, d, a, b, `no ${mn} instruction: call the software routine`);
        break;
      }
      case '<': ins(s ? 'slt' : 'sltu', `${d}, ${a}, ${b}`); break;
      case '>': ins(s ? 'slt' : 'sltu', `${d}, ${b}, ${a}`); break;
      case '<=': ins(s ? 'slt' : 'sltu', `${d}, ${b}, ${a}`); ins('xori', `${d}, ${d}, 1`, '<= is not >'); break;
      case '>=': ins(s ? 'slt' : 'sltu', `${d}, ${a}, ${b}`); ins('xori', `${d}, ${d}, 1`, '>= is not <'); break;
      case '==': ins('sub', `${d}, ${a}, ${b}`); ins('seqz', `${d}, ${d}`, '=='); break;
      case '!=': ins('sub', `${d}, ${a}, ${b}`); ins('snez', `${d}, ${d}`, '!='); break;
      default: throw err(`operator ${op}`, loc);
    }
  }

  function binary(e) {
    if (e.op === '&&' || e.op === '||') {
      const end = newLabel();
      const l = value(e.l);
      const d = dest(l, e.loc);
      ins('snez', `${d}, ${l}`);
      ins(e.op === '&&' ? 'beqz' : 'bnez', `${d}, ${end}`, `${e.op} decided by its left operand`);
      const r = value(e.r);
      ins('snez', `${d}, ${r}`);
      release(r);
      label(end);
      return d;
    }
    const a = value(e.l);
    const b = value(e.r);
    const d = isTemp(a) ? a : isTemp(b) ? b : alloc(e.loc);
    arith(e.op, d, a, b, e.ctype ?? T.int, e.loc, { scale: e.scale, diff: e.diff });
    release(...[a, b].filter((r) => r !== d));
    return d;
  }

  function assign(e) {
    const lv = lvalue(e.l);
    const t = e.l.type;
    if (e.op === '=') {
      if (lv.k === 'reg' && e.r.cv !== undefined && word(t)) { // a constant straight into the register variable
        ins('li', `${lv.r}, ${e.r.cv | 0}`, `${lv.name} = …`);
        return lv.r;
      }
      const v = convert(value(e.r), e.r.type, t);
      store(lv, v, e.loc);
      release(lv.tmp);
      return v;
    }
    const op = e.op.slice(0, -1);
    const b0 = value(e.r);
    const b = !e.scale && e.ctype ? convert(b0, e.r.type, e.ctype) : b0;
    if (lv.k === 'reg' && word(t)) { // computed into the register variable itself
      arith(op, lv.r, lv.r, b, e.ctype ?? T.int, e.loc, { scale: e.scale });
      release(b, b0);
      return lv.r;
    }
    const a = loadCopy(lv, e.loc);
    arith(op, a, a, b, e.ctype ?? T.int, e.loc, { scale: e.scale });
    release(b, b0);
    const v = convert(a, e.ctype ?? t, t);
    store(lv, v, e.loc);
    release(lv.tmp);
    return v;
  }

  function cond(e) {
    const c0 = value(e.c);
    const c = dest(c0, e.loc); // the result goes here in both branches
    const other = newLabel();
    const end = newLabel();
    ins('beqz', `${c0}, ${other}`, '?: false: the second value');
    for (const [x, last] of [[e.a, false], [e.b, true]]) {
      const v = convert(value(x), x.type, e.type);
      if (v && v !== c) ins('mv', `${c}, ${v}`);
      if (v !== c) release(v);
      if (!last) { ins('j', end); label(other); }
    }
    label(end);
    if (e.type.kind === 'void') { release(c); return null; }
    return c;
  }

  /** Save the temporaries in use (except `keep`) in the frame; returns the restore function. */
  function saveTemps(keep, slots) {
    const live = used.filter((r) => !keep.includes(r));
    const base = spillDepth;
    spillDepth += live.length + slots;
    spillMax = Math.max(spillMax, spillDepth);
    live.forEach((r, k) => ins('sw', `${r}, ${4 * (base + k)}(sp)`, 'save a temporary across the call'));
    return {
      argSlot: (j) => 4 * (base + live.length + j),
      restore: () => {
        live.forEach((r, k) => ins('lw', `${r}, ${4 * (base + k)}(sp)`, 'restore the temporary'));
        spillDepth = base;
      },
    };
  }

  function callRoutine(fn, d, a, b, note) {
    needed.add(fn);
    const s = saveTemps([d, a, b], 0);
    ins('mv', `a0, ${a}`, note);
    ins('mv', `a1, ${b}`);
    ins('call', fn);
    s.restore();
    ins('mv', `${d}, a0`);
  }

  function call(e) {
    const f = e.sym;
    if (f.builtin) {
      if (f.name === 'putchar' && ch) throw err(`putchar needs the console of the ISA profile; the ${proc} has no system calls`, e.loc);
      needed.add(f.name);
    }
    const s = saveTemps([], e.args.length);
    e.args.forEach((a, j) => {
      const r = convert(value(a), a.type, f.type.params[j]);
      ins('sw', `${r}, ${s.argSlot(j)}(sp)`, `argument ${j + 1}`);
      release(r);
    });
    e.args.forEach((a, j) => ins('lw', `a${j}, ${s.argSlot(j)}(sp)`));
    ins('call', f.label, `${f.name}(…)`);
    s.restore();
    if (f.type.ret.kind === 'void') return null;
    const r = alloc(e.loc);
    ins('mv', `${r}, a0`, 'the result');
    return r;
  }

  // --- statements ---------------------------------------------------------------------------
  let lastCommented = 0;
  function at(node) {
    cline = node.loc.line;
    if (cline !== lastCommented && srcLines[cline - 1] !== undefined) {
      lastCommented = cline;
      emit(`        # ${cline}: ${srcLines[cline - 1].trim()}`);
    }
  }

  function exprStmt(e) {
    release(value(e));
    if (used.length) throw new Error(`temporaries leaked: ${used.join(', ')}`);
  }

  function condJump(c, falseLabel, note) {
    const r = value(c);
    ins('beqz', `${r}, ${falseLabel}`, note);
    release(r);
  }

  function stmt(s) {
    switch (s.kind) {
      case 'block': s.items.forEach(stmt); return;
      case 'empty': return;
      case 'expr': at(s); exprStmt(s.e); return;
      case 'decl': s.vars.forEach((d) => { if (d.sym && d.init) { at(d); initLocal(d); } }); return;
      case 'if': {
        at(s);
        const other = newLabel();
        condJump(s.c, other, s.else ? 'if: false goes to else' : 'if: false skips the body');
        stmt(s.then);
        if (s.else) {
          const end = newLabel();
          ins('j', end);
          label(other);
          stmt(s.else);
          label(end);
        } else label(other);
        return;
      }
      case 'while': {
        at(s);
        const top = newLabel();
        const end = newLabel();
        label(top);
        condJump(s.c, end, 'while: leave when false');
        loopLabels.push({ brk: end, cont: top });
        stmt(s.body);
        loopLabels.pop();
        ins('j', top);
        label(end);
        return;
      }
      case 'do': {
        at(s);
        const top = newLabel();
        const cont = newLabel();
        const end = newLabel();
        label(top);
        loopLabels.push({ brk: end, cont });
        stmt(s.body);
        loopLabels.pop();
        label(cont);
        at(s.c);
        const r = value(s.c);
        ins('bnez', `${r}, ${top}`, 'do … while: again when true');
        release(r);
        label(end);
        return;
      }
      case 'for': {
        at(s);
        if (s.init) stmt(s.init);
        const top = newLabel();
        const cont = newLabel();
        const end = newLabel();
        label(top);
        if (s.c) { cline = s.loc.line; condJump(s.c, end, 'for: leave when false'); }
        loopLabels.push({ brk: end, cont });
        stmt(s.body);
        loopLabels.pop();
        label(cont);
        if (s.step) { cline = s.loc.line; exprStmt(s.step); }
        ins('j', top);
        label(end);
        return;
      }
      case 'switch': {
        at(s);
        const end = newLabel();
        const v0 = value(s.e);
        const v = convert(v0, s.e.type, s.type);
        const t = alloc(s.loc);
        for (const c of s.cases) {
          c.node.label = newLabel();
          ins('li', `${t}, ${c.value | 0}`);
          ins('beq', `${v}, ${t}, ${c.node.label}`, `case ${c.value | 0}`);
        }
        release(t, v, v0);
        if (s.default) s.default.label = newLabel();
        ins('j', s.default ? s.default.label : end, s.default ? 'default' : 'no case matches');
        loopLabels.push({ brk: end, cont: null });
        stmt(s.body);
        loopLabels.pop();
        label(end);
        return;
      }
      case 'case': case 'default':
        label(s.label);
        stmt(s.stmt);
        return;
      case 'break': at(s); ins('j', loopLabels[loopLabels.length - 1].brk, 'break'); return;
      case 'continue': {
        at(s);
        ins('j', [...loopLabels].reverse().find((l) => l.cont).cont, 'continue');
        return;
      }
      case 'return': {
        at(s);
        if (s.e) {
          const r = convert(value(s.e), s.e.type, current.ret);
          ins('mv', `a0, ${r}`, 'the return value');
          release(r);
        }
        ins('j', current.retLabel);
        return;
      }
      default: throw err(`statement ${s.kind}`, s.loc);
    }
  }

  function initLocal(d) {
    const sym = d.sym;
    const t = sym.type;
    if (t.kind !== 'array') {
      const lv = sym.reg ? { k: 'reg', r: sym.reg, type: t, name: sym.name } : { k: 'mem', base: 's0', off: sym.off, type: t, name: sym.name };
      if (sym.reg && d.init.cv !== undefined && word(t)) { ins('li', `${sym.reg}, ${d.init.cv | 0}`, `${sym.name} = …`); return; }
      const r = convert(value(d.init), d.init.type, t);
      store(lv, r, d.loc);
      release(r);
      return;
    }
    const size = sizeOf(t.of);
    const st = storeInstr(t.of, d.loc);
    const items = d.init.kind === 'str' ? [...d.init.bytes, 0].map((b) => ({ cv: b, type: T.int, kind: 'num', loc: d.loc })) : d.init.items;
    for (let k = 0; k < t.len; k++) {
      const off = sym.off + k * size;
      if (k < items.length) {
        const r = convert(value(items[k]), items[k].type, t.of);
        mem(st, r, off, 's0', `${sym.name}[${k}]`);
        release(r);
      } else mem(st, 'zero', off, 's0', `${sym.name}[${k}] = 0`);
    }
  }

  // --- functions ------------------------------------------------------------------------------
  function func(f) {
    const node = f.node;
    const isMain = f.name === 'main';
    current = { name: f.name, ret: f.sym.type.ret, retLabel: `.L${f.name}_return`, isMain };
    free = [...TEMPS];
    used = [];
    spillDepth = 0;
    spillMax = 0;
    loopLabels = [];
    // frame layout: s0-4 ra, s0-8 s0, then saved s registers, then the locals
    const vars = [...f.params, ...f.locals];
    const saved = [];
    if (target.mode === 'register') {
      for (const v of vars) {
        if (saved.length === SREGS.length) break;
        if ((isInt(v.type) || isPtr(v.type)) && !v.addrTaken && !v.type.volatile) { v.reg = SREGS[saved.length]; saved.push(v.reg); }
      }
    }
    let cursor = 8 + 4 * saved.length;
    for (const v of vars) {
      if (v.reg) continue;
      cursor = alignUp(cursor + sizeOf(v.type), alignOf(v.type));
      v.off = -cursor;
    }
    const localsSize = cursor;
    fbuf = [];
    lastCommented = node.loc.line;
    cline = node.loc.line;
    node.body.items.forEach(stmt);
    const body = fbuf;
    fbuf = null;
    const frame = alignUp(localsSize + 4 * spillMax, 16);

    // prologue
    cline = node.loc.line;
    emit('');
    emit(`# ${srcLines[node.loc.line - 1]?.trim() ?? f.name}`);
    emit(`# frame: ${frame} bytes${saved.length ? `; ${vars.filter((v) => v.reg).map((v) => `${v.name} in ${v.reg}`).join(', ')}` : ''}`);
    label(f.label ?? f.name);
    const regs = [['ra', -4], ['s0', -8], ...saved.map((r, k) => [r, -12 - 4 * k])];
    if (frame <= 2032) {
      ins('addi', `sp, sp, -${frame}`, 'allocate the frame');
      for (const [r, o] of regs) ins('sw', `${r}, ${frame + o}(sp)`, `save ${r}`);
      ins('addi', `s0, sp, ${frame}`, 's0: frame pointer (the caller\'s sp)');
    } else {
      for (const [r, o] of regs) ins('sw', `${r}, ${o}(sp)`, `save ${r}`);
      ins('mv', 's0, sp', 's0: frame pointer (the caller\'s sp)');
      ins('li', `t6, ${frame}`);
      ins('sub', 'sp, sp, t6', 'allocate the frame');
    }
    f.params.forEach((p, k) => {
      if (p.reg) ins('mv', `${p.reg}, a${k}`, `parameter ${p.name}`);
      else mem(storeInstr(p.type, p.loc), `a${k}`, p.off, 's0', `parameter ${p.name}`);
    });
    for (const line of body) out.push(line);
    // epilogue, at the closing brace: main falls off its end with 0 (C99)
    cline = node.body.end.line;
    if (isMain) ins('li', 'a0, 0', 'main returns 0 at its end');
    label(current.retLabel);
    if (frame <= 2032) {
      for (const [r, o] of [...regs].reverse()) ins('lw', `${r}, ${frame + o}(sp)`, `restore ${r}`);
      ins('addi', `sp, sp, ${frame}`, 'free the frame');
    } else {
      ins('mv', 'sp, s0');
      for (const [r, o] of [...regs].reverse()) ins('lw', `${r}, ${o}(sp)`, `restore ${r}`);
    }
    if (isMain && ch) ins('j', '__halt', 'main returns: the program halts');
    else ins('ret');
  }

  // --- data ------------------------------------------------------------------------------------
  function dataLines() {
    const dir = { 1: '.byte', 2: '.half', 4: '.word' };
    for (const s of prog.data) {
      cline = s.loc.line;
      const t = s.type;
      const elemT = t.kind === 'array' ? t.of : t;
      const n = t.kind === 'array' ? t.len : 1;
      const size = sizeOf(elemT);
      const al = alignOf(t);
      if (al > 1) emit(`        .align  ${log2(al)}`);
      emit(`${s.label}:${' '.repeat(Math.max(1, 23 - s.label.length))}# ${typeName(t)} ${s.name}${s.storage === 'static' ? ' (static)' : ''}`);
      const items = s.init ?? [];
      const vals = items.map((x) => (x.label ? `${x.label}${x.offset ? `+${x.offset}` : ''}` : String(constText(x.value, elemT))));
      for (let k = 0; k < vals.length; k += 8) emit(`        ${dir[size].padEnd(8)}${vals.slice(k, k + 8).join(', ')}`);
      if (n > items.length) emit(`        .zero   ${(n - items.length) * size}`);
    }
    for (const s of prog.strings) {
      cline = s.loc.line;
      emit(`${s.label}:${' '.repeat(Math.max(1, 23 - s.label.length))}# "${s.bytes.map((b) => (b >= 32 && b < 127 && b !== 34 && b !== 92 ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`)).join('')}"`);
      const bytes = [...s.bytes, 0];
      for (let k = 0; k < bytes.length; k += 16) emit(`        .byte   ${bytes.slice(k, k + 16).join(', ')}`);
    }
  }
  /** A constant as a data directive writes it: the bit pattern of its size, signed for a signed int. */
  const constText = (v, t) => {
    const size = sizeOf(t);
    if (size < 4) return v & (size === 1 ? 0xff : 0xffff);
    return t.kind === 'int' && t.signed ? v | 0 : v >>> 0;
  };

  // --- the program -------------------------------------------------------------------------------
  cline = 0;
  emit('        .text');
  for (const l of startup(target)) emit(l);
  for (const f of prog.funcs) func(f);
  cline = 0;
  for (const l of routines([...needed], target)) emit(l);
  if (prog.data.length || prog.strings.length) {
    emit('');
    emit('        .data');
    dataLines();
  }
  return { lines: out, routines: [...needed] };
}

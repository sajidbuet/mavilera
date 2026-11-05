// i8086/isa.js -- the 8086 instruction set as one table (roadmap 8086-B1, docs/roadmaps/INTEL-8086-DEVELOPMENT-ROADMAP.md
// §6): the decoder, the disassembler and the assembler all read it. Op codes, operand forms and ModR/M meaning are
// facts of Intel's 8086 Family User's Manual (9800722-03, Oct 1979), Tables 4-7 to 4-14 (machine instruction encoding
// and decoding guide), entered by hand [INTEL]. The status of each form (normal, alias, undocumented, undefined, fpu,
// prefix) follows SingleStepTests/8086 v1 `metadata.json` at commit e71c68d [TEST]; test/i8086-isa.test.mjs checks the
// table against that file when it is present. No code or layout of any emulator or assembler is used (C4).
//
// Operand specifications (the notation is the simulator's own):
//   Eb Ew   ModR/M register or memory operand, byte or word      Gb Gw  the ModR/M reg field as a register
//   Sw      the ModR/M reg field as a segment register           M      memory only (LEA); Mp memory, a far pointer
//   Ib Iw   immediate byte or word; Is a byte sign-extended to a word
//   Jb Jw   relative jump displacement; Ap a direct far address (offset, segment)
//   Ob Ow   a direct memory address (no ModR/M), byte or word
//   Zb Zw   a register in the op code's low three bits; AL AX CL DX ES CS SS DS: that register; 1 and 3: constants
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const REG8 = Object.freeze(['AL', 'CL', 'DL', 'BL', 'AH', 'CH', 'DH', 'BH']);
export const REG16 = Object.freeze(['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI']);
export const SREG = Object.freeze(['ES', 'CS', 'SS', 'DS']);
/** The ModR/M r/m field's base and index registers (IFUM Table 4-10). */
export const RM_BASE = Object.freeze(['BX+SI', 'BX+DI', 'BP+SI', 'BP+DI', 'SI', 'DI', 'BP', 'BX']);
/** Segment override prefixes (IFUM Table 4-13). */
export const SEG_PREFIX = Object.freeze({ 0x26: 'ES', 0x2e: 'CS', 0x36: 'SS', 0x3e: 'DS' });
export const SEG_PREFIX_BYTE = Object.freeze({ ES: 0x26, CS: 0x2e, SS: 0x36, DS: 0x3e });

export const G1 = Object.freeze(['ADD', 'OR', 'ADC', 'SBB', 'AND', 'SUB', 'XOR', 'CMP']);
export const G2 = Object.freeze(['ROL', 'ROR', 'RCL', 'RCR', 'SHL', 'SHR', 'SETMO', 'SAR']);
export const JCC = Object.freeze(['JO', 'JNO', 'JB', 'JAE', 'JE', 'JNE', 'JBE', 'JA', 'JS', 'JNS', 'JP', 'JNP', 'JL', 'JGE', 'JLE', 'JG']);
/** Other names of the conditional jumps and prefixes the assembler accepts (IFUM Table 2-15). */
export const ALIASES = Object.freeze({
  JC: 'JB', JNAE: 'JB', JNB: 'JAE', JNC: 'JAE', JZ: 'JE', JNZ: 'JNE', JNA: 'JBE', JNBE: 'JA', JPE: 'JP', JPO: 'JNP',
  JNGE: 'JL', JNL: 'JGE', JNG: 'JLE', JNLE: 'JG', SAL: 'SHL', LOOPZ: 'LOOPE', LOOPNZ: 'LOOPNE', REPZ: 'REPE', REPNZ: 'REPNE',
  XLATB: 'XLAT',
});

/**
 * One entry per form: {op, reg (the ModR/M reg field of a group, else null), mnem, ops (specs), status, asm (the
 * assembler emits it)}. `byOpcode[op]` is the entry, or for a group an array of eight by reg field.
 */
const T = [];
const add = (op, mnem, ops = '', status = 'normal', reg = null, asm = status === 'normal') =>
  T.push(Object.freeze({ op, reg, mnem, ops: Object.freeze(ops ? ops.split(',') : []), status, asm }));

G1.forEach((m, n) => {
  const b = 8 * n;
  add(b, m, 'Eb,Gb'); add(b + 1, m, 'Ew,Gw'); add(b + 2, m, 'Gb,Eb'); add(b + 3, m, 'Gw,Ew'); add(b + 4, m, 'AL,Ib'); add(b + 5, m, 'AX,Iw');
});
add(0x06, 'PUSH', 'ES'); add(0x07, 'POP', 'ES'); add(0x0e, 'PUSH', 'CS'); add(0x0f, 'POP', 'CS', 'normal', null, false);
add(0x16, 'PUSH', 'SS'); add(0x17, 'POP', 'SS'); add(0x1e, 'PUSH', 'DS'); add(0x1f, 'POP', 'DS');
for (const [op, s] of Object.entries(SEG_PREFIX)) add(Number(op), `${s}:`, '', 'prefix');
add(0x27, 'DAA'); add(0x2f, 'DAS'); add(0x37, 'AAA'); add(0x3f, 'AAS');
for (let r = 0; r < 8; r++) {
  add(0x40 + r, 'INC', 'Zw'); add(0x48 + r, 'DEC', 'Zw'); add(0x50 + r, 'PUSH', 'Zw'); add(0x58 + r, 'POP', 'Zw');
}
JCC.forEach((m, c) => { add(0x60 + c, m, 'Jb', 'alias'); add(0x70 + c, m, 'Jb'); });
G1.forEach((m, r) => {
  add(0x80, m, 'Eb,Ib', 'normal', r); add(0x81, m, 'Ew,Iw', 'normal', r); add(0x82, m, 'Eb,Ib', 'alias', r); add(0x83, m, 'Ew,Is', 'normal', r);
});
add(0x84, 'TEST', 'Eb,Gb'); add(0x85, 'TEST', 'Ew,Gw'); add(0x86, 'XCHG', 'Eb,Gb'); add(0x87, 'XCHG', 'Ew,Gw');
add(0x88, 'MOV', 'Eb,Gb'); add(0x89, 'MOV', 'Ew,Gw'); add(0x8a, 'MOV', 'Gb,Eb'); add(0x8b, 'MOV', 'Gw,Ew');
add(0x8c, 'MOV', 'Ew,Sw'); add(0x8d, 'LEA', 'Gw,M'); add(0x8e, 'MOV', 'Sw,Ew');
for (let r = 0; r < 8; r++) add(0x8f, 'POP', 'Ew', r ? 'undefined' : 'normal', r);
add(0x90, 'NOP');
for (let r = 1; r < 8; r++) add(0x90 + r, 'XCHG', 'AX,Zw');
add(0x98, 'CBW'); add(0x99, 'CWD'); add(0x9a, 'CALL', 'Ap'); add(0x9b, 'WAIT'); add(0x9c, 'PUSHF'); add(0x9d, 'POPF');
add(0x9e, 'SAHF'); add(0x9f, 'LAHF');
add(0xa0, 'MOV', 'AL,Ob'); add(0xa1, 'MOV', 'AX,Ow'); add(0xa2, 'MOV', 'Ob,AL'); add(0xa3, 'MOV', 'Ow,AX');
add(0xa4, 'MOVSB'); add(0xa5, 'MOVSW'); add(0xa6, 'CMPSB'); add(0xa7, 'CMPSW'); add(0xa8, 'TEST', 'AL,Ib'); add(0xa9, 'TEST', 'AX,Iw');
add(0xaa, 'STOSB'); add(0xab, 'STOSW'); add(0xac, 'LODSB'); add(0xad, 'LODSW'); add(0xae, 'SCASB'); add(0xaf, 'SCASW');
for (let r = 0; r < 8; r++) { add(0xb0 + r, 'MOV', 'Zb,Ib'); add(0xb8 + r, 'MOV', 'Zw,Iw'); }
add(0xc0, 'RET', 'Iw', 'alias'); add(0xc1, 'RET', '', 'alias'); add(0xc2, 'RET', 'Iw'); add(0xc3, 'RET');
add(0xc4, 'LES', 'Gw,Mp'); add(0xc5, 'LDS', 'Gw,Mp');
for (let r = 0; r < 8; r++) { add(0xc6, 'MOV', 'Eb,Ib', r ? 'undefined' : 'normal', r); add(0xc7, 'MOV', 'Ew,Iw', r ? 'undefined' : 'normal', r); }
add(0xc8, 'RETF', 'Iw', 'alias'); add(0xc9, 'RETF', '', 'alias'); add(0xca, 'RETF', 'Iw'); add(0xcb, 'RETF');
add(0xcc, 'INT', '3'); add(0xcd, 'INT', 'Ib'); add(0xce, 'INTO'); add(0xcf, 'IRET');
G2.forEach((m, r) => {
  const st = r === 6 ? 'undocumented' : 'normal';
  add(0xd0, m, 'Eb,1', st, r); add(0xd1, m, 'Ew,1', st, r); add(0xd2, m, 'Eb,CL', st, r); add(0xd3, m, 'Ew,CL', st, r);
});
add(0xd4, 'AAM', 'Ib'); add(0xd5, 'AAD', 'Ib'); add(0xd6, 'SALC', '', 'undocumented'); add(0xd7, 'XLAT');
for (let k = 0; k < 8; k++) add(0xd8 + k, 'ESC', 'Ew', 'fpu');
add(0xe0, 'LOOPNE', 'Jb'); add(0xe1, 'LOOPE', 'Jb'); add(0xe2, 'LOOP', 'Jb'); add(0xe3, 'JCXZ', 'Jb');
add(0xe4, 'IN', 'AL,Ib'); add(0xe5, 'IN', 'AX,Ib'); add(0xe6, 'OUT', 'Ib,AL'); add(0xe7, 'OUT', 'Ib,AX');
add(0xe8, 'CALL', 'Jw'); add(0xe9, 'JMP', 'Jw'); add(0xea, 'JMP', 'Ap'); add(0xeb, 'JMP', 'Jb');
add(0xec, 'IN', 'AL,DX'); add(0xed, 'IN', 'AX,DX'); add(0xee, 'OUT', 'DX,AL'); add(0xef, 'OUT', 'DX,AX');
add(0xf0, 'LOCK', '', 'prefix'); add(0xf1, 'LOCK', '', 'prefix'); add(0xf2, 'REPNE', '', 'prefix'); add(0xf3, 'REP', '', 'prefix');
add(0xf4, 'HLT'); add(0xf5, 'CMC');
['TEST', 'TEST', 'NOT', 'NEG', 'MUL', 'IMUL', 'DIV', 'IDIV'].forEach((m, r) => {
  add(0xf6, m, r < 2 ? 'Eb,Ib' : 'Eb', r === 1 ? 'alias' : 'normal', r);
  add(0xf7, m, r < 2 ? 'Ew,Iw' : 'Ew', r === 1 ? 'alias' : 'normal', r);
});
add(0xf8, 'CLC'); add(0xf9, 'STC'); add(0xfa, 'CLI'); add(0xfb, 'STI'); add(0xfc, 'CLD'); add(0xfd, 'STD');
['INC', 'DEC'].forEach((m, r) => add(0xfe, m, 'Eb', 'normal', r));
for (let r = 2; r < 8; r++) add(0xfe, '(FE)', 'Eb', 'undefined', r);
[['INC', 'Ew'], ['DEC', 'Ew'], ['CALL', 'Ew'], ['CALL', 'Mp'], ['JMP', 'Ew'], ['JMP', 'Mp'], ['PUSH', 'Ew'], ['PUSH', 'Ew']].forEach(([m, o], r) =>
  add(0xff, m, o, r === 7 ? 'alias' : 'normal', r));

export const FORMS = Object.freeze(T);
export const BY_OPCODE = Object.freeze((() => {
  const out = new Array(256).fill(null);
  for (const e of T) {
    if (e.reg === null) out[e.op] = e;
    else (out[e.op] ??= new Array(8).fill(null))[e.reg] = e;
  }
  return out;
})());
export const GROUPS = Object.freeze(new Set([0x80, 0x81, 0x82, 0x83, 0x8f, 0xc6, 0xc7, 0xd0, 0xd1, 0xd2, 0xd3, 0xf6, 0xf7, 0xfe, 0xff]));
const MODRM_SPECS = new Set(['Eb', 'Ew', 'Gb', 'Gw', 'Sw', 'M', 'Mp']);
export const needsModrm = (e) => GROUPS.has(e.op) || e.ops.some((s) => MODRM_SPECS.has(s));

/** The status of an op code (with its ModR/M byte for groups and register-only forms) in the [TEST] classification. */
export function statusOf(e, modrm) {
  if (!e) return 'undefined';
  const mod = modrm >> 6;
  if (mod === 3 && [0x8d, 0xc4, 0xc5].includes(e.op)) return 'undefined'; // LEA, LES, LDS with a register operand
  if (mod === 3 && e.op === 0xff && (e.reg === 3 || e.reg === 5)) return 'undefined'; // far CALL or JMP through a register
  return e.status;
}

/**
 * Decode one instruction. `fetch(k)` gives byte k from the start (prefixes included). Returns {length, bytes,
 * prefixes, seg, rep, lock, entry, status, modrm, operands} or {error: 'empty'} when 16 prefix bytes come with no op code.
 * Operands: {t: 'reg', size, n} | {t: 'sreg', n} | {t: 'mem', size, mod, rm, disp, direct} | {t: 'imm', size, value}
 * | {t: 'rel', size, value} (signed) | {t: 'far', seg, off} | {t: 'const', value}.
 */
export function decode(fetch) {
  let k = 0;
  const prefixes = [];
  let seg = null; let rep = null; let lock = false;
  for (;;) {
    const b = fetch(k);
    const e = BY_OPCODE[b];
    if (!e || Array.isArray(e) || e.status !== 'prefix') break;
    prefixes.push(b);
    if (SEG_PREFIX[b]) seg = SEG_PREFIX[b];
    else if (b === 0xf2) rep = 'REPNE';
    else if (b === 0xf3) rep = 'REP';
    else lock = true;
    k += 1;
    if (k >= 16) return { error: 'empty', length: k };
  }
  const op = fetch(k++);
  let entry = BY_OPCODE[op];
  let modrm = null;
  if (Array.isArray(entry) || (entry && needsModrm(entry))) {
    modrm = fetch(k++);
    if (Array.isArray(entry)) entry = entry[(modrm >> 3) & 7];
  }
  const word = (i) => fetch(i) | (fetch(i + 1) << 8);
  const operands = [];
  let mem = null;
  if (modrm !== null) {
    const mod = modrm >> 6; const rm = modrm & 7;
    if (mod !== 3) {
      let disp = 0; const direct = mod === 0 && rm === 6;
      if (mod === 1) { disp = (fetch(k) << 24) >> 24; k += 1; } else if (mod === 2 || direct) { disp = word(k); k += 2; }
      mem = { mod, rm, disp, direct, dispSize: mod === 1 ? 1 : mod === 2 || direct ? 2 : 0 };
    }
  }
  const mo = modrm === null ? 0 : modrm;
  const regField = (mo >> 3) & 7; const rmField = mo & 7;
  for (const s of entry.ops) {
    switch (s) {
      case 'Eb': case 'Ew': case 'M': case 'Mp':
        operands.push(mem ? { t: 'mem', size: s === 'Eb' ? 8 : s === 'Ew' ? 16 : s === 'Mp' ? 32 : null, ...mem }
          : { t: 'reg', size: s === 'Eb' ? 8 : 16, n: rmField });
        break;
      case 'Gb': operands.push({ t: 'reg', size: 8, n: regField }); break;
      case 'Gw': operands.push({ t: 'reg', size: 16, n: regField }); break;
      case 'Sw': operands.push({ t: 'sreg', n: regField & 3, raw: regField }); break; // the 8086 checks two bits [TEST]
      case 'Ib': operands.push({ t: 'imm', size: 8, value: fetch(k) }); k += 1; break;
      case 'Is': operands.push({ t: 'imm', size: 16, value: ((fetch(k) << 24) >> 24) & 0xffff, short: true }); k += 1; break;
      case 'Iw': operands.push({ t: 'imm', size: 16, value: word(k) }); k += 2; break;
      case 'Jb': operands.push({ t: 'rel', size: 8, value: (fetch(k) << 24) >> 24 }); k += 1; break;
      case 'Jw': operands.push({ t: 'rel', size: 16, value: (word(k) << 16) >> 16 }); k += 2; break;
      case 'Ap': operands.push({ t: 'far', off: word(k), seg: word(k + 2) }); k += 4; break;
      case 'Ob': case 'Ow':
        operands.push({ t: 'mem', size: s === 'Ob' ? 8 : 16, mod: 0, rm: 6, disp: word(k), direct: true, dispSize: 2, moffs: true }); k += 2; break;
      case 'Zb': operands.push({ t: 'reg', size: 8, n: op & 7 }); break;
      case 'Zw': operands.push({ t: 'reg', size: 16, n: op & 7 }); break;
      case 'AL': operands.push({ t: 'reg', size: 8, n: 0 }); break;
      case 'AX': operands.push({ t: 'reg', size: 16, n: 0 }); break;
      case 'CL': operands.push({ t: 'reg', size: 8, n: 1 }); break;
      case 'DX': operands.push({ t: 'reg', size: 16, n: 2 }); break;
      case 'ES': case 'CS': case 'SS': case 'DS': operands.push({ t: 'sreg', n: SREG.indexOf(s) }); break;
      case '1': operands.push({ t: 'const', value: 1 }); break;
      case '3': operands.push({ t: 'const', value: 3 }); break;
      default: throw new Error(`operand spec ${s}`);
    }
  }
  const bytes = Array.from({ length: k }, (_, i) => fetch(i));
  return { length: k, bytes, prefixes, seg, rep, lock, op, entry, status: statusOf(entry, mo), modrm, operands };
}

/** Decode from an array of bytes (missing bytes read as 0). */
export const decodeBytes = (bytes) => decode((k) => bytes[k] ?? 0);

/** Hexadecimal with a trailing H and a leading 0 before a letter (05H, 0FFH, 1234H, 0FFFEH), as ASM-86 writes it. */
export const hexH = (v, digits) => {
  const s = (v >>> 0).toString(16).toUpperCase().padStart(digits, '0');
  return `${/^[A-F]/.test(s) ? '0' : ''}${s}H`;
};
const signedHex = (v, digits) => (v < 0 ? `-${hexH(-v, digits)}` : `+${hexH(v, digits)}`);

/** A memory operand as ASM-86 writes it: [BX+SI+12H], [1234H], ES:[DI]. */
export function memText(o, seg) {
  const inner = o.direct ? hexH(o.disp & 0xffff, 4)
    : `${RM_BASE[o.rm]}${o.dispSize === 1 ? signedHex(o.disp, 2) : o.dispSize === 2 ? signedHex((o.disp << 16) >> 16, 4) : ''}`;
  return `${seg ? `${seg}:` : ''}[${inner}]`;
}

const PTR = { 8: 'BYTE PTR ', 16: 'WORD PTR ', 32: 'DWORD PTR ' };
const STRING_OPS = new Set(['MOVSB', 'MOVSW', 'CMPSB', 'CMPSW', 'STOSB', 'STOSW', 'LODSB', 'LODSW', 'SCASB', 'SCASW']);
/** The prefix name of F3 before an instruction: REPE with CMPS and SCAS, REP otherwise (IFUM Table 2-13). */
export const repName = (rep, mnem) => (rep === 'REP' && /^(CMPS|SCAS)/.test(mnem) ? 'REPE' : rep);

/**
 * The text of a decoded instruction in the simulator's ASM-86 style. `ip` is the offset of the instruction's first byte
 * in its code segment (for jump targets); `null` writes relative targets as $+n.
 */
export function format(d, ip = null) {
  if (d.error) return 'DB ?';
  if (d.status !== 'normal' && d.status !== 'fpu') return `DB ${d.bytes.map((b) => hexH(b, 2)).join(', ')}`;
  const e = d.entry;
  // BYTE PTR or WORD PTR when no register of the form gives the size (CL, a shift's count, does not)
  const sized = e.ops.some((s) => ['Gb', 'Gw', 'AL', 'AX', 'Zb', 'Zw', 'Sw'].includes(s));
  const sizeNeeded = !sized && !['LEA', 'LDS', 'LES', 'ESC'].includes(e.mnem);
  let segUsed = false;
  const text = d.operands.map((o) => {
    switch (o.t) {
      case 'reg': return (o.size === 8 ? REG8 : REG16)[o.n];
      case 'sreg': return SREG[o.n];
      case 'mem': {
        segUsed = true;
        const ptr = (sizeNeeded || o.size === 32) && !o.moffs && o.size ? PTR[o.size] : '';
        return `${ptr}${memText(o, d.seg)}`;
      }
      case 'imm': return hexH(o.value, o.size === 8 ? 2 : 4);
      case 'rel': {
        if (ip === null) return `$${o.value + d.length >= 0 ? '+' : ''}${o.value + d.length}`;
        return hexH((ip + d.length + o.value) & 0xffff, 4);
      }
      case 'far': return `${hexH(o.seg, 4)}:${hexH(o.off, 4)}`;
      case 'const': return String(o.value);
      default: return '?';
    }
  });
  let m = e.mnem;
  if (e.op === 0xeb) text[0] = `SHORT ${text[0]}`;
  if (e.op === 0xcc) text.length = 0; // INT 3: one byte, written INT 3
  if (e.op === 0xcc) text.push('3');
  if ((e.op === 0xd4 || e.op === 0xd5) && d.operands[0].value === 0x0a) text.length = 0; // AAM, AAD with the usual base 10
  if (e.op >= 0xd8 && e.op <= 0xdf) text.unshift(hexH(((e.op & 7) << 3) | ((d.modrm >> 3) & 7), 2));
  const pre = [];
  if (d.lock) pre.push('LOCK');
  if (d.rep) pre.push(STRING_OPS.has(m) ? repName(d.rep, m) : d.rep);
  if (d.seg && !segUsed) pre.push(`${d.seg}:`);
  return `${pre.length ? `${pre.join(' ')} ` : ''}${m}${text.length ? ` ${text.join(', ')}` : ''}`;
}

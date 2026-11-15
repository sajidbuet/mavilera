// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { FLAG } from './cpu.js';
export const NMI_TYPE = 2;
export const STEP_TYPE = 1;
export const DEFAULT_INTR_TYPE = 0x08;
const DELAY_MAX = 999;
export function initialInputs() {
 return { nmi: false, intr: false, type: DEFAULT_INTR_TYPE, coming: [], boundary: { nmi: true, intr: true, trap: false } };
}
export const copyInputs = (s) => ({ nmi: s.nmi, intr: s.intr, type: s.type, coming: s.coming.map((x) => ({ ...x })),
 boundary: s.boundary ? { ...s.boundary } : null });
export function applyInput(s, x) {
 if (!x || typeof x !== 'object') return false;
 const delay = Math.max(0, Math.min(DELAY_MAX, Math.floor(Number(x.delay) || 0)));
 const now = { ...('nmi' in x ? { nmi: Boolean(x.nmi) } : {}), ...('intr' in x ? { intr: Boolean(x.intr) } : {}),
 ...(Number.isInteger(x.type) && x.type >= 0 && x.type <= 255 ? { type: x.type } : {}) };
 if (!('nmi' in now) && !('intr' in now) && !('type' in now)) return false;
 if (delay > 0) s.coming.push({ left: delay, ...now });
 else arrive(s, now);
 return true;
}
function arrive(s, x) {
 if (x.nmi) s.nmi = true;
 if ('intr' in x) s.intr = x.intr;
 if ('type' in x) s.type = x.type;
}
export function tick(s) {
 if (!s.coming.length) return;
 for (const x of s.coming) x.left -= 1;
 for (const x of s.coming.filter((y) => y.left <= 0)) arrive(s, x);
 s.coming = s.coming.filter((x) => x.left > 0);
}
export function arriveAll(s) {
 for (const x of s.coming) arrive(s, x);
 s.coming = [];
}
export function boundaryAfter(oldFlags, mnem, segLoad) {
 if (segLoad) return { nmi: false, intr: false, trap: false };
 const delayIntr = mnem === 'STI' || mnem === 'IRET';
 return { nmi: true, intr: !delayIntr, trap: Boolean(oldFlags & FLAG.TF) };
}
export const REP_BOUNDARY = Object.freeze({ nmi: true, intr: true, trap: false });
export function due(s, flags) {
 const b = s.boundary;
 if (!b) return null;
 if (b.nmi && s.nmi) return 'nmi';
 if (b.intr && s.intr && flags & FLAG.IF) return 'intr';
 if (b.trap) return 'trap';
 return null;
}
export function repStopper(s, getFlags) {
 return () => { tick(s); return s.nmi || (s.intr && Boolean(getFlags() & FLAG.IF)); };
}
export function take(s, kind) {
 if (kind === 'nmi') { s.nmi = false; s.boundary.nmi = false; return NMI_TYPE; }
 if (kind === 'intr') { s.boundary.intr = false; return s.type; }
 s.boundary.trap = false;
 return STEP_TYPE;
}
export const loadsSegment = (d) => (d.entry?.mnem === 'MOV' || d.entry?.mnem === 'POP') && d.operands?.[0]?.t === 'sreg';

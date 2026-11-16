// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const HW_CODES = Object.freeze(['unsupported', 'insecure', 'denied', 'not-found', 'busy', 'access', 'disconnected', 'invalid-firmware',
 'not-bootable', 'not-permitted', 'wrong-chip', 'timeout', 'verify-failed', 'cancelled', 'failed']);
export class HardwareError extends Error {
 constructor(code, message, data = {}) {
 super(message);
 this.name = 'HardwareError';
 this.code = HW_CODES.includes(code) ? code : 'failed';
 this.data = data;
 }
}
export function toHardwareError(e, during = '') {
 if (e instanceof HardwareError) return e;
 const inner = e?.cause ?? e?.originalError ?? null;
 const name = inner?.name ?? e?.name ?? '';
 const msg = String(e?.message ?? e ?? '');
 const all = `${msg} ${inner?.message ?? ''}`;
 if (/timed out/i.test(all)) return new HardwareError('timeout', msg, { during });
 if (/disconnected|device (was|has been) (lost|removed)|No device selected|device unavailable/i.test(all) && name !== 'NotFoundError') return new HardwareError('disconnected', msg, { during });
 if (name === 'NotFoundError' || e?.name === 'NotFoundError') return new HardwareError('denied', msg, { during });
 if (name === 'SecurityError') return new HardwareError('access', msg, { during });
 if (/claim|in use|busy|already open|Failed to open/i.test(all) || name === 'InvalidStateError') return new HardwareError('busy', msg, { during });
 if (name === 'NetworkError') return new HardwareError('disconnected', msg, { during });
 return new HardwareError('failed', msg, { during });
}

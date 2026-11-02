// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const PLATFORM_ARCHS = Object.freeze([
 Object.freeze({ id: 'riscv', name: 'RISC-V', logo: 'mavilera-logo.svg' }),
 Object.freeze({ id: 'sap-1', name: 'SAP-1', logo: 'mavilera-logo-sap-1.svg' }),
 Object.freeze({ id: 'sap-2', name: 'SAP-2', logo: 'mavilera-logo-sap-2.svg' }),
 Object.freeze({ id: 'armv7', name: 'Armv7', logo: 'mavilera-logo-armv7.svg' }),
]);
export function homeUrl({ protocol, href, release }) {
 if (protocol === 'file:') return 'https://sajidlab.org/mavilera/';
 return release ? new URL('../', href).href : null;
}
export function archUrl(id, { protocol, href, release }) {
 if (protocol === 'file:') return `https://sajidlab.org/mavilera/${id}/`;
 return release ? new URL(`../${id}/`, href).href : `?arch=${id}`;
}
export function switchTargets(currentId, where, list = PLATFORM_ARCHS) {
 const dev = where.protocol !== 'file:' && !where.release;
 return list.filter((a) => a.id !== currentId && (!a.preview || dev)).map(({ preview, ...a }) => ({ ...a, url: archUrl(a.id, where) }));
}

// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const PLATFORM_ARCHS = Object.freeze([
 Object.freeze({ id: 'riscv', name: 'RISC-V', logo: 'mavilera-name-riscv.svg', views: Object.freeze(['isa', 'single', 'multi', 'pipe', 'compare']) }),
 Object.freeze({ id: 'sap-1', name: 'SAP-1', logo: 'mavilera-name-sap-1.svg' }),
 Object.freeze({ id: 'sap-2', name: 'SAP-2', logo: 'mavilera-name-sap-2.svg' }),
 Object.freeze({ id: 'armv7', name: 'Armv7', logo: 'mavilera-name-armv7.svg' }),
 Object.freeze({ id: 'i8086', name: '8086', logo: 'mavilera-name-8086.svg' }),
 Object.freeze({ id: 'npu', name: 'NPU', logo: 'mavilera-name-npu.svg', header: 'mavilera-logo-npu.svg', module: 'riscv',
 view: 'npu', views: Object.freeze(['isa', 'npu-single', 'npu', 'npu-analysis']) }),
 Object.freeze({ id: 'gpu', name: 'GPU', logo: 'mavilera-name-gpu.svg' }),
]);
export const NAME_AT = 1625.8 / 192;
export function homeUrl({ protocol, href, release }) {
 if (protocol === 'file:' || !release) return 'https://sajidlab.org/mavilera/';
 return new URL('../', href).href;
}
export function archUrl(id, { protocol, href, release }) {
 if (protocol === 'file:') return `https://sajidlab.org/mavilera/${id}/`;
 return release ? new URL(`../${id}/`, href).href : `?arch=${id}`;
}
export function toolUrl(tool, where) {
 if (!tool.module) return archUrl(tool.id, where);
 const base = archUrl(tool.module, where);
 return `${base}${base.includes('?') ? '&' : '?'}tool=${tool.id}`;
}
export function toolViews(arch, tool) {
 const list = tool?.views;
 const shown = list ? arch.views.filter((v) => list.includes(v.id)) : arch.views;
 return shown.length ? shown : arch.views;
}
export const HOSTED_TOOLS = Object.freeze([
 Object.freeze({ id: 'cpu-gpu', name: 'CPU + GPU', logo: 'mavilera-name-gpu.svg', header: 'mavilera-logo-gpu.svg', module: 'riscv', within: 'gpu',
 view: 'gpu-host', views: Object.freeze(['isa', 'gpu-single', 'gpu-host']), profile: 'ch11', platform: Object.freeze({ gpu: true }),
 template: 'cpu-gpu-abs' }),
]);
export function currentTool(archId, search, list = PLATFORM_ARCHS) {
 const asked = new URLSearchParams(search).get('tool');
 const all = list === PLATFORM_ARCHS ? [...list, ...HOSTED_TOOLS] : list;
 return all.find((t) => t.id === asked && t.module === archId) ?? all.find((t) => t.id === archId) ?? null;
}
export function switchTargets(currentId, where, list = PLATFORM_ARCHS) {
 const dev = where.protocol !== 'file:' && !where.release;
 return list.filter((a) => a.id !== currentId && (!a.preview || dev))
 .map((a) => ({ id: a.id, name: a.name, logo: a.logo, url: toolUrl(a, where) }));
}

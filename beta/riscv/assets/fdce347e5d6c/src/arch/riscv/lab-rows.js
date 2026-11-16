// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { RISCV_STRINGS as RV } from './strings.js';
export function labRows(platform) {
 if (!platform) return [];
 const L = RV.lab;
 const { spans, npu } = platform.measurement();
 return [
 ...spans.map((s) => [L.span(s.from, s.to), s.cycles]),
 ...(npu && npu.accesses ? [[L.npuAccesses, npu.accesses], [L.statusReads, npu.statusReads], [L.runs, npu.runs],
 ...(npu.ignoredWrites ? [[L.ignoredWrites, npu.ignoredWrites]] : [])] : []),
 ];
}
export function labDiagnostics(platform) {
 return (platform?.npu?.diagnostics ?? []).map((d) => ({ kind: 'npu', message: RV.lab.diagnostic(d.message, d.cycle), at: d.cycle }));
}

// lab-rows.js -- the counters of the Chapter 11 laboratory measurement (NPU-2) for the counters panel of every
// RISC-V engine and view with the platform: the cycles between the GPIO OUT markers and the NPU's access counts,
// as tb_npu_soc prints them (RUN INFO). Rows appear once there is something to count.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { RISCV_STRINGS as RV } from './strings.js';

/** [label, value] rows from a Platform (or [] without one). */
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

/** The NPU's non-fatal diagnostics (decision G5: a RESULT read while busy) as engine diagnostics. */
export function labDiagnostics(platform) {
  return (platform?.npu?.diagnostics ?? []).map((d) => ({ kind: 'npu', message: RV.lab.diagnostic(d.message, d.cycle), at: d.cycle }));
}

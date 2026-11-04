// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const DERIVED = Object.freeze({
 EXEC_I: { wires: ['rs1_sa', 'imm_sb', 'sa_alu', 'sb_alu', 'alu_j', 'alu_aq'], tagsOf: ['ADDR'] },
 LUI: { wires: ['imm_sb', 'sb_alu', 'alu_j', 'alu_aq'], tagsOf: ['ADDR'] },
 AUIPC: { wires: ['ipc_sa', 'imm_sb', 'sa_alu', 'sb_alu', 'alu_j', 'alu_aq'], tagsOf: ['ADDR'] },
});
const NOT_TAKEN = new Set(['aq_rm', 'rm_res', 'res_pc']);
function boxes(geom) {
 return geom.elements.map((e) => {
 if (e.size) return { id: e.id, x0: e.at[0] - e.size[0] / 2, x1: e.at[0] + e.size[0] / 2, y0: e.at[1] - e.size[1] / 2, y1: e.at[1] + e.size[1] / 2 };
 const o = geom.pics[e.type].outline;
 const xs = o.map((p) => e.at[0] + p[0]);
 const ys = o.map((p) => e.at[1] + p[1]);
 return { id: e.id, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
 });
}
export function multiPaths(geom) {
 const wires = new Map(geom.wires.map((w) => [w.id, w]));
 const bx = boxes(geom);
 const eps = 0.03;
 const at = ([x, y]) => bx.filter((b) => x >= b.x0 - eps && x <= b.x1 + eps && y >= b.y0 - eps && y <= b.y1 + eps).map((b) => b.id);
 const tags = Object.values(geom.figures).flatMap((f) => f.tags);
 const tagsOf = (state) => tags.filter((t) => t.text.split(', ').includes(state));
 return function statePath(state, s = {}) {
 const d = DERIVED[state] ?? geom.derived?.[state];
 const ids = new Set(d ? d.wires : geom.steps[state] ?? []);
 if (state === 'BRANCH' && !s.PCEn) for (const id of NOT_TAKEN) ids.delete(id);
 const elements = new Set(['cu']);
 for (const id of ids) {
 const w = wires.get(id);
 for (const p of [w.points[0], w.points[w.points.length - 1]]) for (const e of at(p)) elements.add(e);
 if (w.from_net) elements.add(w.from_net);
 }
 const t = (d ? d.tagsOf.flatMap(tagsOf) : tagsOf(state))
 .filter((x) => !(state === 'BRANCH' && !s.PCEn && x.text.includes('JAL')))
 .map((x) => ({ text: state, at: x.at, anchor: x.anchor }));
 return { wires: ids, elements, tags: t };
 };
}

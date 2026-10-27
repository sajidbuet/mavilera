// multi-paths.js -- the paths of the current state of the Chapter 7
// multicycle processor (spec WS-F-040): which connections and elements of the
// drawing (content/geometry/ch07.json) the state uses, and the boxed state
// names that say so. The connections of the ten states drawn in FIG-0068 and
// FIG-0069 are the chapter's own (geometry `steps`, exported from
// code/chapter07/make_fig_datapath.py); those of EXEC_I, LUI and AUIPC are
// derived here from their state outputs and the same rules, and those of the
// optional JALR state come with it (`geom.derived`, src/uarch/ch07-jalr.js);
// all are checked by test/multi-paths.test.mjs. A branch that is not taken does not write the
// PC, so its connections from alu_q to the PC are then not highlighted.
// Pure JavaScript.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/** States not drawn in the chapter's figures: connections, and the drawn state whose tags they share. */
export const DERIVED = Object.freeze({
  EXEC_I: { wires: ['rs1_sa', 'imm_sb', 'sa_alu', 'sb_alu', 'alu_j', 'alu_aq'], tagsOf: ['ADDR'] },
  LUI: { wires: ['imm_sb', 'sb_alu', 'alu_j', 'alu_aq'], tagsOf: ['ADDR'] },
  AUIPC: { wires: ['ipc_sa', 'imm_sb', 'sa_alu', 'sb_alu', 'alu_j', 'alu_aq'], tagsOf: ['ADDR'] },
});

const NOT_TAKEN = new Set(['aq_rm', 'rm_res', 'res_pc']);

/** Bounding boxes of the drawing's elements (cm). */
function boxes(geom) {
  return geom.elements.map((e) => {
    if (e.size) return { id: e.id, x0: e.at[0] - e.size[0] / 2, x1: e.at[0] + e.size[0] / 2, y0: e.at[1] - e.size[1] / 2, y1: e.at[1] + e.size[1] / 2 };
    const o = geom.pics[e.type].outline;
    const xs = o.map((p) => e.at[0] + p[0]);
    const ys = o.map((p) => e.at[1] + p[1]);
    return { id: e.id, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
}

/** The state-path function of a drawing. */
export function multiPaths(geom) {
  const wires = new Map(geom.wires.map((w) => [w.id, w]));
  const bx = boxes(geom);
  const eps = 0.03;
  const at = ([x, y]) => bx.filter((b) => x >= b.x0 - eps && x <= b.x1 + eps && y >= b.y0 - eps && y <= b.y1 + eps).map((b) => b.id);
  const tags = Object.values(geom.figures).flatMap((f) => f.tags);
  const tagsOf = (state) => tags.filter((t) => t.text.split(', ').includes(state));

  /**
   * @param {string} state current state
   * @param {{PCEn?: number}} s signals of the cycle (a BRANCH with PCEn = 0 does not reach the PC)
   * @returns {{wires: Set<string>, elements: Set<string>, tags: Array<{text, at, anchor}>}}
   */
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
      .filter((x) => !(state === 'BRANCH' && !s.PCEn && x.text.includes('JAL'))) // the tag at the PC path
      .map((x) => ({ text: state, at: x.at, anchor: x.anchor }));
    return { wires: ids, elements, tags: t };
  };
}

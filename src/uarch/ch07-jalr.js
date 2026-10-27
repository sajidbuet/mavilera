// ch07-jalr.js -- merges the optional JALR state of the multicycle processor
// (content/data/ch07-jalr.json, written apart by tools/export_ch07.py because it is
// the answer of an exercise; releases leave the file out, spec W-D20) back into the
// controller tables and the state diagram. Each entry is put back at the index it
// was taken from, so the merged lists equal the lists before the split.
// Pure JavaScript.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const putBack = (list, entries) => {
  for (const { index, item } of [...entries].sort((a, b) => a.index - b.index)) list.splice(index, 0, item);
};

/**
 * @param {object|null} geom content/geometry/ch07.json (null: tables only)
 * @param {object} t7 content/data/ch07-tables.json
 * @param {object|null} x content/data/ch07-jalr.json, or null where it is absent
 * @returns {{geom: object|null, t7: object, jalrAvailable: boolean}} copies; the inputs are not changed
 */
export function withJalr(geom, t7, x) {
  if (!x) return { geom, t7, jalrAvailable: false };
  const t = structuredClone(t7);
  putBack(t.state_outputs.columns, x.columns);
  putBack(t.transitions, x.transitions);
  putBack(t.cycles, x.cycles);
  let g = geom;
  if (g) {
    g = structuredClone(geom);
    putBack(g.fsm.states, x.fsm.states);
    putBack(g.fsm.arcs, x.fsm.arcs);
    for (const o of x.fsm.arc_on) {
      for (const a of g.fsm.arcs) if (a.from === o.from && a.to === o.to && !a.on) a.on = o.on;
    }
    g.fsm.junctions_jalr = x.fsm.junctions_jalr;
    g.derived = { ...(g.derived ?? {}), ...x.derived };
  }
  return { geom: g, t7: t, jalrAvailable: true };
}

const fetched = new Map();

/** Fetch content/data/ch07-jalr.json from `base` (once per base); null when the file is absent. A release
 *  page (tools/release.mjs marks it with a meta element) has no such file, so nothing is requested there. */
export function fetchJalr(base) {
  if (globalThis.document?.querySelector('meta[name="risc-vista-edition"][content="release"]')) return Promise.resolve(null);
  const url = new URL('content/data/ch07-jalr.json', base).href;
  if (!fetched.has(url)) {
    fetched.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return fetched.get(url);
}

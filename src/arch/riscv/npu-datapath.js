// npu-datapath.js -- the single-cycle datapath of Chapter 6 extended with a device on its data bus: the Chapter 11 NPU
// for the NPU view (NPU-3), and the GPU module's SIMT core for the CPU + GPU tool (GPU-7, decision G30; same drawing,
// its own names). A simulator drawing, not a book figure: the Chapter 6 geometry (content/geometry/ch06.json, from the
// book's generator) is kept, the parts right of the data memory move 1 cm to the right, and three things are added:
//   - the device as a block (addr from alu_y, wd from rs2_val, its read data; we = MemWrite, sel = its select),
//   - a read-data multiplexer (dsel) between the data memory's rd and the result multiplexer, selected by sel_ram
//     (the NPU's names are those of the book's soc_npu.sv: sel_ram, sel_acc, acc_rdata; the GPU's are MAVILERA's:
//     sel_gpu, gpu_rdata; ram_rdata is the RAM's read data),
//   - the activity of a cycle that reaches the device instead of the RAM.
// The other platform devices (GPIO, timer, UART) are left out of this drawing; the System level of the view shows them.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { NPU_BASE } from '../../mem/npu.js';

const SHIFT_FROM = 11.5; // cm: everything at or right of this moves
const SHIFT = 1.0; // cm

const moveX = (x) => (x >= SHIFT_FROM ? +(x + SHIFT).toFixed(4) : x);
const movePt = ([x, y]) => [moveX(x), y];

/**
 * The extension for a device {id, base, size, sel, rdata, label (on the block), alt (the sentence added to the
 * description)}: {info, extend, dataTarget, values, path}, the parts the single-cycle view takes as `extend`.
 */
export function deviceDatapath({ id, base, size = 0x1000, sel, rdata, label, alt }) {
  const info = Object.freeze({
    ram_rdata: { width: 32, kind: 'data' }, [rdata]: { width: 32, kind: 'data' },
    sel_ram: { width: 1, kind: 'control' }, [sel]: { width: 1, kind: 'control' },
  });

  /** The Chapter 6 geometry with the device and the read-data multiplexer (pure; the input is not changed). */
  function extend(g) {
    const out = structuredClone(g);
    for (const e of out.elements) e.at = movePt(e.at);
    for (const w of out.wires) {
      w.points = w.points.map(movePt);
      for (const l of w.labels ?? []) l.at = movePt(l.at);
    }
    for (const c of out.control) c.points = c.points.map(movePt);
    for (const l of out.labels) l.at = movePt(l.at);
    out.junctions = out.junctions.map(movePt);
    for (const f of Object.values(out.figures ?? {})) for (const a of f.arrivals ?? []) a.at = movePt(a.at);

    // the data memory's rd now ends at the read-data multiplexer
    const dm = out.wires.find((w) => w.id === 'dm_rm');
    dm.points = [[11.15, -0.45], [11.45, -0.45]];
    dm.signal = 'ram_rdata';
    out.elements.push({ id: 'dsel', type: 'mux2', at: [11.45, -0.05] });
    out.elements.push({ id, type: 'block', at: [15.0, 1.55], size: [2.2, 1.9], text: '' });
    const bus = (wid, points, signal) => ({ id: wid, style: 'bus', arrow: true, points, signal, labels: [] });
    out.wires.push(
      bus('dsel_rm', [[12.05, -0.05], [12.25, -0.05], [12.25, -0.45], [12.75, -0.45]], 'rdata'),
      bus(`alu_${id}`, [[12.55, 2.15], [13.9, 2.15]], 'alu_y'),
      bus(`rd2_${id}`, [[9.45, -2.75], [13.7, -2.75], [13.7, 1.0], [13.9, 1.0]], 'rs2_val'),
      bus(`${id}_dsel`, [[13.9, 1.6], [11.3, 1.6], [11.3, 0.35], [11.45, 0.35]], rdata),
    );
    out.junctions.push([12.55, 2.15], [9.45, -2.75]);
    out.control.push(
      { signal: 'sel_ram', points: [[11.75, 1.3], [11.75, 0.55]], place: 'right' },
      { signal: 'MemWrite', points: [[14.4, 3.0], [14.4, 2.5]], place: 'left' },
      { signal: sel, points: [[14.95, 3.0], [14.95, 2.5]], place: 'right' },
    );
    out.labels.push(
      { type: 'label', style: 'figlabel', at: [15.35, 1.55], anchor: 'center', text: label },
      { type: 'label', style: 'sig', at: [13.9, 2.15], anchor: 'west', text: 'addr' },
      { type: 'label', style: 'sig', at: [13.9, 1.6], anchor: 'west', text: 'rd' },
      { type: 'label', style: 'sig', at: [13.9, 1.0], anchor: 'west', text: 'wd' },
    );
    out.alt = `${g.alt} ${alt}`;
    return out;
  }

  /** Does the cycle's data access (signals of the single-cycle model) reach the device, the RAM, or nothing? */
  function dataTarget(s) {
    const access = s.MemWrite || s.ResultSel === 1;
    if (!access) return null;
    const a = s.alu_y >>> 0;
    if (a >= base && a < base + size) return id;
    return a < 0x40000000 ? 'ram' : 'device';
  }

  /** The values of the new signals in a cycle. */
  function values(s) {
    const t = dataTarget(s);
    const load = s.ResultSel === 1 && !s.MemWrite;
    return {
      [sel]: t === id ? 1 : 0, sel_ram: t === 'ram' ? 1 : 0,
      [rdata]: t === id && load ? s.rdata >>> 0 : 0, ram_rdata: t === 'ram' && load ? s.rdata >>> 0 : 0,
    };
  }

  /** The active path of the cycle (single-paths.js activePath) on the extended drawing. */
  function path(s, p) {
    const w = new Set(p.wires);
    const e = new Set(p.elements);
    const t = dataTarget(s);
    if (t === id) {
      for (const x of ['alu_dm', 'rd2_dm', 'dm_rm']) w.delete(x);
      e.delete('dm');
      e.add(id);
      w.add('alu_a').add('alu_rm').add(`alu_${id}`); // the address reaches the device along the ALU's output line (alu_rm) to its junction
      if (s.MemWrite) w.add(`rd2_${id}`);
      if (w.has('result_rf') && s.ResultSel === 1) { w.add(`${id}_dsel`).add('dsel_rm'); e.add('dsel'); }
    } else if (w.has('dm_rm')) {
      w.add('dsel_rm');
      e.add('dsel');
    }
    return { wires: w, elements: e };
  }

  return { info, extend, dataTarget, values, path };
}

const NPU = deviceDatapath({ id: 'npu', base: NPU_BASE, sel: 'sel_acc', rdata: 'acc_rdata', label: 'NPU\n0x5000_0000',
  alt: 'Extended by the simulator: the NPU on the data bus beside the data memory (address from the ALU, write data from rs2), and a read-data multiplexer, selected by sel_ram, between the data memory and the result multiplexer.' });

/** The new signals of the NPU drawing, with the widths of SIGNAL_INFO's form. */
export const NPU_DP_INFO = NPU.info;
export const extendForNpu = NPU.extend;
export const dataTarget = NPU.dataTarget;
export const npuDpValues = NPU.values;
export const npuDpPath = NPU.path;

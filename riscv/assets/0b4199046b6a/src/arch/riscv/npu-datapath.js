// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { NPU_BASE } from '../../mem/npu.js';
const SHIFT_FROM = 11.5;
const SHIFT = 1.0;
export const NPU_DP_INFO = Object.freeze({
 ram_rdata: { width: 32, kind: 'data' }, acc_rdata: { width: 32, kind: 'data' },
 sel_ram: { width: 1, kind: 'control' }, sel_acc: { width: 1, kind: 'control' },
});
const moveX = (x) => (x >= SHIFT_FROM ? +(x + SHIFT).toFixed(4) : x);
const movePt = ([x, y]) => [moveX(x), y];
export function extendForNpu(g) {
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
 const dm = out.wires.find((w) => w.id === 'dm_rm');
 dm.points = [[11.15, -0.45], [11.45, -0.45]];
 dm.signal = 'ram_rdata';
 out.elements.push({ id: 'dsel', type: 'mux2', at: [11.45, -0.05] });
 out.elements.push({ id: 'npu', type: 'block', at: [15.0, 1.55], size: [2.2, 1.9], text: '' });
 const bus = (id, points, signal) => ({ id, style: 'bus', arrow: true, points, signal, labels: [] });
 out.wires.push(
 bus('dsel_rm', [[12.05, -0.05], [12.25, -0.05], [12.25, -0.45], [12.75, -0.45]], 'rdata'),
 bus('alu_npu', [[12.55, 2.15], [13.9, 2.15]], 'alu_y'),
 bus('rd2_npu', [[9.45, -2.75], [13.7, -2.75], [13.7, 1.0], [13.9, 1.0]], 'rs2_val'),
 bus('npu_dsel', [[13.9, 1.6], [11.3, 1.6], [11.3, 0.35], [11.45, 0.35]], 'acc_rdata'),
 );
 out.junctions.push([12.55, 2.15], [9.45, -2.75]);
 out.control.push(
 { signal: 'sel_ram', points: [[11.75, 1.3], [11.75, 0.55]], place: 'right' },
 { signal: 'MemWrite', points: [[14.4, 3.0], [14.4, 2.5]], place: 'left' },
 { signal: 'sel_acc', points: [[14.95, 3.0], [14.95, 2.5]], place: 'right' },
 );
 out.labels.push(
 { type: 'label', style: 'figlabel', at: [15.35, 1.55], anchor: 'center', text: 'NPU\n0x5000_0000' },
 { type: 'label', style: 'sig', at: [13.9, 2.15], anchor: 'west', text: 'addr' },
 { type: 'label', style: 'sig', at: [13.9, 1.6], anchor: 'west', text: 'rd' },
 { type: 'label', style: 'sig', at: [13.9, 1.0], anchor: 'west', text: 'wd' },
 );
 out.alt = `${g.alt} Extended by the simulator: the NPU on the data bus beside the data memory (address from the ALU, write data from rs2), and a read-data multiplexer, selected by sel_ram, between the data memory and the result multiplexer.`;
 return out;
}
export function dataTarget(s) {
 const access = s.MemWrite || s.ResultSel === 1;
 if (!access) return null;
 const a = s.alu_y >>> 0;
 if (a >= NPU_BASE && a < NPU_BASE + 0x1000) return 'npu';
 return a < 0x40000000 ? 'ram' : 'device';
}
export function npuDpValues(s) {
 const t = dataTarget(s);
 const load = s.ResultSel === 1 && !s.MemWrite;
 return {
 sel_acc: t === 'npu' ? 1 : 0, sel_ram: t === 'ram' ? 1 : 0,
 acc_rdata: t === 'npu' && load ? s.rdata >>> 0 : 0, ram_rdata: t === 'ram' && load ? s.rdata >>> 0 : 0,
 };
}
export function npuDpPath(s, path) {
 const w = new Set(path.wires);
 const e = new Set(path.elements);
 const t = dataTarget(s);
 if (t === 'npu') {
 for (const id of ['alu_dm', 'rd2_dm', 'dm_rm']) w.delete(id);
 e.delete('dm');
 e.add('npu');
 w.add('alu_a').add('alu_rm').add('alu_npu');
 if (s.MemWrite) w.add('rd2_npu');
 if (w.has('result_rf') && s.ResultSel === 1) { w.add('npu_dsel').add('dsel_rm'); e.add('dsel'); }
 } else if (w.has('dm_rm')) {
 w.add('dsel_rm');
 e.add('dsel');
 }
 return { wires: w, elements: e };
}

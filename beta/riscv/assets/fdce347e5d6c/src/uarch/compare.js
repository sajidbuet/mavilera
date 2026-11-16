// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { assemble } from '../asm/assembler.js';
import { SingleCycle } from './single.js';
import { Multicycle } from './multi.js';
import { Pipeline } from './pipe.js';
import { classTable, delayMap } from './timing.js';
import { buildMemsys, validateConfig } from '../mem/config.js';
export const ORGANISATIONS = Object.freeze(['ch06', 'ch07', 'ch08']);
export function clockPeriods({ t6, delays6, t7, timing8 }) {
 return { ch06: classTable(delayMap(delays6), t6).tc, ch07: t7.timing.tc, ch08: timing8.tc };
}
function runProcessor(profile, p, data, { jalr, predictor, entries, limit, memsys = null }) {
 const m = profile === 'ch06' ? new SingleCycle(data.t6, { historyLimit: 0, memsys })
 : profile === 'ch07' ? new Multicycle(data.t6, data.t7, { jalr, historyLimit: 0, memsys })
 : new Pipeline(data.t6, { hazard: 'full', predictor, entries, historyLimit: 0, memsys });
 m.load(p);
 let stop;
 try {
 stop = m.run(limit);
 } catch {
 return { ok: false, error: 'limit', detail: String(limit) };
 }
 if (stop !== 'halt') return { ok: false, error: 'stopped', detail: m.error ?? '' };
 const waits = memsys?.timed ? memsys.stats.waitCycles : 0;
 const n = profile === 'ch06' ? m.cycle - waits : profile === 'ch07' ? m.retired : m.stats.retired;
 const mem = m.dmem ?? m.mem;
 const dataBase = profile === 'ch07' ? 0x200 / 4 : 0;
 const final = { x: Array.from(m.x), data: Array.from(mem.words.slice(dataBase, dataBase + 64)) };
 return { ok: true, n, cycles: m.cycle, final, memsys };
}
export function compare(files, data, { jalr = false, predictor = 'none', entries = 8, limit = 1_000_000 } = {}) {
 const tc = clockPeriods(data);
 const finals = {};
 const rows = ORGANISATIONS.map((profile) => {
 const p = assemble(files, { profile });
 if (!p.ok) return { profile, ok: false, error: 'assembly', detail: p.errors[0]?.message ?? '' };
 if (p.profileErrors.length) return { profile, ok: false, error: 'profile', detail: p.profileErrors[0].mnemonic };
 const r = runProcessor(profile, p, data, { jalr, predictor, entries, limit });
 if (!r.ok) return { profile, ...r };
 const { n, cycles } = r;
 finals[profile] = r.final;
 return { profile, ok: true, n, cycles, cpi: n ? cycles / n : null, tc: tc[profile], timePs: cycles * tc[profile] };
 });
 const base = rows[0].ok ? rows[0].timePs : null;
 const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
 for (const r of rows) {
 r.speedup = r.ok && base && r.timePs ? base / r.timePs : null;
 r.agrees = r.ok && r.profile !== 'ch06' && finals.ch06
 ? same(finals[r.profile].x, finals.ch06.x) && same(finals[r.profile].data, finals.ch06.data) : null;
 }
 return { rows, tc };
}
export const SCENARIOS = Object.freeze(['A', 'B', 'C']);
export function scenarioConfigs(cfg) {
 const out = { A: { ...cfg, mode: 'ideal' }, B: { ...cfg, mode: 'main' }, C: { ...cfg, mode: 'cache' }, problems: { A: [], B: [], C: [] } };
 for (const s of ['B', 'C']) {
 out.problems[s] = validateConfig(out[s]);
 if (out.problems[s].length) out[s] = null;
 }
 return out;
}
function memoryFigures(r) {
 const rep = r.memsys?.timed ? r.memsys.report() : null;
 const l = rep?.ledger ?? { waitCycles: 0, data: 0, fetch: 0, arbitration: 0, transactions: 0 };
 return { stalls: { data: l.data, fetch: l.fetch, arbitration: l.arbitration, total: l.waitCycles }, transactions: l.transactions,
 hit: { I: rep?.I?.accesses ? rep.I.hitRate : null, D: rep?.D?.accesses ? rep.D.hitRate : null } };
}
export function compareMemory(files, data, cfg, { jalr = false, predictor = 'none', entries = 8, limit = 1_000_000 } = {}) {
 const sc = scenarioConfigs(cfg);
 const rows = [];
 const ideal = {};
 for (const profile of ORGANISATIONS) {
 const p = assemble(files, { profile });
 for (const scenario of SCENARIOS) {
 const base = { profile, scenario };
 if (!p.ok) { rows.push({ ...base, ok: false, error: 'assembly', detail: p.errors[0]?.message ?? '' }); continue; }
 if (p.profileErrors.length) { rows.push({ ...base, ok: false, error: 'profile', detail: p.profileErrors[0].mnemonic }); continue; }
 if (!sc[scenario]) { rows.push({ ...base, ok: false, error: 'config', detail: sc.problems[scenario][0] }); continue; }
 const { memsys } = buildMemsys(sc[scenario]);
 const r = runProcessor(profile, p, data, { jalr, predictor, entries, limit, memsys });
 if (!r.ok) { rows.push({ ...base, ...r }); continue; }
 if (scenario === 'A') ideal[profile] = r.final;
 const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
 rows.push({ ...base, ok: true, n: r.n, cycles: r.cycles, cpi: r.n ? r.cycles / r.n : null, ipc: r.cycles ? r.n / r.cycles : null,
 ...memoryFigures(r),
 sameResult: scenario === 'A' ? null : ideal[profile] ? same(r.final.x, ideal[profile].x) && same(r.final.data, ideal[profile].data) : null });
 }
 }
 return { rows, ratios: memoryRatios(rows), scenarios: sc };
}
export function memoryRatios(rows) {
 const at = (profile, scenario) => rows.find((r) => r.profile === profile && r.scenario === scenario && r.ok) ?? null;
 const div = (a, b) => (a && b && b > 0 ? a / b : null);
 const out = { perProcessor: {}, cpiVsSingle: {} };
 for (const profile of ORGANISATIONS) {
 const [a, b, c] = SCENARIOS.map((s) => at(profile, s));
 out.perProcessor[profile] = { cOverA: div(c?.cycles, a?.cycles), cOverB: div(c?.cycles, b?.cycles), bOverA: div(b?.cycles, a?.cycles) };
 }
 for (const scenario of SCENARIOS) {
 const single = at('ch06', scenario);
 out.cpiVsSingle[scenario] = Object.fromEntries(ORGANISATIONS.map((p) => [p, div(at(p, scenario)?.cpi, single?.cpi)]));
 }
 return out;
}
export function memoryCsv({ rows }) {
 const head = ['processor', 'scenario', 'cycles', 'retired', 'cpi', 'ipc', 'stall_data', 'stall_fetch', 'stall_arbitration', 'stall_total',
 'transactions', 'hit_rate_L1I', 'hit_rate_L1D', 'same_result_as_ideal', 'error'];
 const num = (v, d = 4) => (v === null || v === undefined ? '' : Number.isInteger(v) ? String(v) : v.toFixed(d));
 const lines = rows.map((r) => [r.profile, r.scenario, ...(r.ok ? [r.cycles, r.n, num(r.cpi), num(r.ipc), r.stalls.data, r.stalls.fetch, r.stalls.arbitration,
 r.stalls.total, r.transactions, num(r.hit.I), num(r.hit.D), r.sameResult === null ? '' : r.sameResult, ''] : ['', '', '', '', '', '', '', '', '', '', '', '', `${r.error}`])]
 .map((v) => String(v)).join(','));
 return `${[head.join(','), ...lines].join('\n')}\n`;
}

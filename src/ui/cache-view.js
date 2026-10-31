// cache-view.js -- the cache viewer of the Cache tab (docs/architecture/memory-hierarchy.md §11 phase 5c, WS-F-112):
// for each cache, what the last access did, how an address finds its line (tag, index and offset, step by
// step), and the lines themselves as a grid of sets and ways with their state. Reading a cache here
// counts no access (mem-viewmodel.js). Pure presentation: the engine is cache.js.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, hex8 } from './dom.js';
import { STRINGS } from './strings.js';
import { addressFields, lineRows, rowWords, geometry } from './mem-viewmodel.js';
import { CacheAnim } from './cache-anim.js';

const M = () => STRINGS.mem; // read when used: the architecture's strings are merged in after this module loads
const V = M().cv;
const SETS_PER_PAGE = 8;
const hex = (v) => `0x${(v >>> 0).toString(16)}`;
const pad = (v, bits) => (bits ? (v >>> 0).toString(2).padStart(bits, '0') : '');
const group4 = (s) => s.replace(/(?=(\d{4})+$)/g, ' ').trim(); // groups of four bits from the right

/** The address split drawn as three boxes, widths in proportion to the bits; `fields` marks a mapped address. */
export function splitBar({ tagBits, indexBits, offsetBits }, fields = null) {
  const part = (cls, name, bits, value) => el(`span.addr-part.addr-${cls}`, { style: `flex: ${Math.max(bits, 1)} 1 0` },
    el('span.addr-name', { text: `${name} (${bits})` }), fields ? el('span.addr-val.mono', { text: bits ? value.toString(16) : '-' }) : null);
  return el('div.addr-split', { role: 'img', 'aria-label': `${M().split}: ${M().tag} ${tagBits} bits, ${M().index} ${indexBits} bits, ${M().offset} ${offsetBits} bits` },
    part('tag', M().tag, tagBits, fields?.tag ?? 0), part('index', M().index, indexBits, fields?.index ?? 0), part('offset', M().offset, offsetBits, fields?.offset ?? 0));
}

/** The 32 bits of an address in three coloured groups, each named under its bits. */
function addressBits(f) {
  const part = (cls, name, bits, value) => el(`span.cv-bits.addr-${cls}`, {}, el('span.cv-binary.mono', { text: bits ? group4(pad(value, bits)) : '-' }),
    el('span.cv-bitsname', { text: `${name} · ${bits}` }));
  return el('div.cv-address', { role: 'img', 'aria-label': `${hex8(f.addr)}: ${M().tag} ${hex(f.tag)}, ${M().index} ${f.index}, ${M().offset} ${f.offset}` },
    part('tag', M().tag, f.tagBits, f.tag), part('index', M().index, f.indexBits, f.index), part('offset', M().offset, f.offsetBits, f.offset));
}

/** One sentence (or two) on what the last access of a cache did. */
function lastAccess(cache) {
  const r = cache.last;
  if (!r) return [el('p.cv-last', { text: V.lastNone })];
  const op = V.op[r.op];
  const a = hex8(r.addr);
  if (r.hit) return [el('p.cv-last.cv-hit', {}, el('strong', { text: V.lastHit(op, a, r.set, r.way) }), r.writeThrough ? ` ${V.lastThrough}` : '')];
  const lines = [el('strong', { text: V.lastMiss(op, a, V.kinds[r.kind]) })];
  if (r.filled) {
    lines.push(` ${V.lastFill(hex8(r.block), r.set, r.way)}`);
    if (r.evicted !== null) lines.push(` ${V.lastEvict(hex8(r.evicted), r.evictedDirty)}`);
  } else lines.push(` ${V.lastNoAlloc}`);
  if (r.writeThrough && r.filled) lines.push(` ${V.lastThrough}`);
  return [el('p.cv-last.cv-miss', {}, ...lines)];
}

/** The steps by which `f` (addressFields) finds, or fails to find, its line. */
function walkthrough(cache, f) {
  const S = cache.sets[f.index];
  const steps = [el('li', {}, V.walkAddr(hex8(f.addr)), addressBits(f))];
  steps.push(el('li', { text: f.indexBits ? V.walkIndex(f.indexBits, f.index) : V.walkIndexNone }));
  S.lines.forEach((l, w) => steps.push(el(`li.cv-way${f.held && f.way === w ? '.cv-way-hit' : ''}`, {},
    V.walkWay(w, l.valid ? V.wayTag(hex(l.tag), l.tag === f.tag) : V.wayEmpty))));
  if (f.held) steps.push(el('li.cv-result.cv-hit', { text: V.walkHit(f.way) }));
  else {
    const p = cache.plan('read', f.addr, 1); // what a read would do; nothing changes
    const free = !p.victim;
    steps.push(el('li.cv-result.cv-miss', { text: `${V.walkMiss(hex8(f.blockAddr))} ${free ? V.walkFree(p.way)
      : V.walkVictim(p.way, hex8(p.victim.addr), p.victim.dirty, cache.cfg.repl === 'random' ? V.walkRandom : V.policy[cache.cfg.repl])}` }));
  }
  steps.push(el('li', { text: V.walkOffset(f.offset, f.offset >> 2, f.offset & 3) }));
  return el('ol.cv-steps', { 'aria-label': V.walkTitle }, steps);
}

const SUBS = ['I', 'D', 'stats', 'help'];

export class CacheView {
  /** @param {{resolve: (text: string) => number|null}} o resolve: an address, label or register as the memory pane reads it */
  constructor({ resolve }) {
    this.resolve = resolve;
    this.addr = null; // an address typed by the user; null: follow the last access
    this.page = { I: 0, D: 0 };
    this.anims = { I: new CacheAnim(), D: new CacheAnim() }; // one player per cache, kept across redraws
    this.perPage = 16;
    this.follow = true;
    this.sub = 'I';
    this.input = el('input.mono', { type: 'text', size: 24, placeholder: M().addrPlaceholder, 'aria-label': M().addrLabel, 'data-k': 'cache-addr',
      onkeydown: (e) => { if (e.key === 'Enter') { this.addr = e.target.value.trim() ? this.resolve(e.target.value) : null; this.draw(); } } });
    this.tabBar = el('div.cv-subtabs', { role: 'tablist', 'aria-label': M().tabCache });
    this.tabButtons = SUBS.map((k) => el('button', { type: 'button', role: 'tab', id: `cv-tab-${k}`, text: V.sub[k], onclick: () => { this.sub = k; this.draw(); } }));
    this.tabBar.append(...this.tabButtons);
    this.tabBar.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      this.sub = SUBS[(SUBS.indexOf(this.sub) + d + SUBS.length) % SUBS.length];
      this.draw();
      this.tabButtons[SUBS.indexOf(this.sub)].focus();
    });
    this.status = el('div.cv-status');
    this.out = el('div.cache-out.scroll', { role: 'tabpanel' });
    this.root = el('div.cache-view', {}, this.tabBar, this.status, this.out);
    this.ctx = null;
  }

  /** Draw again for `ctx` {memsys, cfg, mode, accessed, fetch, ...}; nothing is drawn while the tab is hidden. */
  update(ctx) {
    this.ctx = ctx;
    if (this.root.isConnected && this.root.offsetParent !== null) this.draw();
  }

  /** The caches to show: those of the memory system, or in the instruction-level view those of the traced run. */
  cachesOf(c) {
    if (c.memsys && c.cfg.mode === 'cache') return c.memsys.caches;
    return c.trace?.caches ?? null;
  }

  draw() {
    const c = this.ctx;
    if (!c) return;
    const caches = this.cachesOf(c);
    this.tabButtons.forEach((b, i) => {
      const on = SUBS[i] === this.sub;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    this.out.setAttribute('aria-labelledby', `cv-tab-${this.sub}`);
    this.status.replaceChildren(...this.statusLine(c, caches));
    const body = this.sub === 'stats' ? this.statsTab(c, caches) : this.sub === 'help' ? this.helpTab(c, caches) : this.cacheTab(c, caches, this.sub);
    this.out.replaceChildren(...body);
  }

  /** One line over every sub-tab: why there is nothing to show, or the button of the instruction-level view. */
  statusLine(c, caches) {
    const { memsys, cfg } = c;
    if (cfg.mode === 'cache' && !memsys && c.analyse) {
      const r = c.trace;
      return [el('button', { type: 'button', text: M().traceButton, onclick: () => c.analyse() }),
        r ? el('span.note', { text: ` ${M().traceDone(r.instructions, M().traceStops[r.stop])}${r.error ? ` ${r.error}` : ''}${c.traceStale ? ` ${M().traceStale}` : ''}` }) : null];
    }
    if (cfg.mode === 'cache' && memsys) return [];
    return [el('p.note', { text: cfg.mode === 'main' ? M().cacheOffMain : M().cacheOff }), cfg.mode !== 'ideal' && !memsys ? el('details.cv-more', {}, el('summary', { text: V.aboutTiming }), el('p.note', { text: M().noTiming })) : null];
  }

  /** The full cache of one side: its last access, and every line as a grid. */
  cacheTab(c, caches, key) {
    const name = key === 'I' ? 'L1I' : 'L1D';
    const cache = caches?.[key];
    if (!cache) return [el('p.note', { text: caches ? `${name}: ${M().noCache}` : V.nothingYet })];
    const at = this.addr ?? (key === 'I' ? c.fetch : c.accessed?.addr ?? cache.last?.addr) ?? null;
    const f = at === null ? null : addressFields(cache, at);
    const g = geometry(cache);
    this.anims[key].show(cache.last, cache);
    return [el('div.cv-bar', {},
      el('span.cv-geom', { text: `${name} · ${M().geometry(g)}` }),
      el('div.cv-card.cv-lastcard', {}, el('span.cv-card-k', { text: V.lastTitle }), ...lastAccess(cache))),
    this.anims[key].root,
    ...this.withLegend(this.grid(cache, key, f))];
  }

  /** Counters of both caches side by side, the wait cycles, and the path from processor to memory. */
  statsTab(c, caches) {
    const out = [this.diagram(c)];
    if (c.memsys && c.cfg.mode !== 'ideal') out.push(this.ledger(c.memsys.stats));
    if (caches) out.push(el('div.cv-pair', {}, ...[['I', 'L1I'], ['D', 'L1D']].map(([k, name]) => (caches[k] ? this.stats(caches[k], name) : el('p.note', { text: `${name}: ${M().noCache}` })))));
    out.push(el('details.cv-more', {}, el('summary', { text: V.aboutCounts }), el('p.note', { text: M().cacheNote })));
    return out;
  }

  /** The address to map, how it is found in each cache, and what the words mean. */
  helpTab(c, caches) {
    const out = [el('div.cv-bar', {}, el('label', {}, `${M().addrLabel} `, this.input), el('span.note', { text: V.addrHint })),
      el('div.cv-pair', {}, ...[['I', 'L1I'], ['D', 'L1D']].map(([k, name]) => {
        const cache = caches?.[k];
        if (!cache) return el('p.note', { text: `${name}: ${caches ? M().noCache : V.nothingYet}` });
        const at = this.addr ?? (k === 'I' ? c.fetch : c.accessed?.addr ?? cache.last?.addr) ?? null;
        return el('section.cv-card', { 'aria-label': name }, el('h4', {}, `${name} · ${V.walkTitle}`), at === null ? el('p.note', { text: V.noAddress }) : walkthrough(cache, addressFields(cache, at)));
      })),
      el('div.cv-help', {}, el('h4', { text: V.helpTitle }), ...V.help.map(([term, text]) => el('p', {}, el('strong', { text: `${term}. ` }), text)))];
    return out;
  }

  diagram({ mode, cfg }) {
    const box = (text, cls = '') => el(`span.mem-box${cls}`, { text });
    const arrow = () => el('span.mem-arrow', { 'aria-hidden': 'true', text: '→' });
    const cpu = M().cpuNames[mode] ?? M().cpuNames.compare;
    // the arrow from the processor to its ports: I (fetch) and D (data), each through its cache when there is one
    const path = (tag, name, on) => el('span.mem-path', {}, el('span.mem-tag', { text: tag }), arrow(),
      ...(cfg.mode === 'cache' && on ? [box(name, '.mem-on'), arrow()] : []));
    return el('div.mem-diagram', { role: 'img', 'aria-label': M().diagram(cpu) },
      box(cpu, '.mem-cpu'), el('span.mem-paths', {}, path('I', 'L1I', cfg.l1i.on), path('D', 'L1D', cfg.l1d.on)), box(M().ram));
  }

  /** Wait cycles by cause, as one row of chips. */
  ledger(l) {
    const chip = (k, v) => el('span.cv-chip', {}, el('span.cv-chip-k', { text: k }), el('span.cv-chip-v.mono', { text: String(v) }));
    return el('div.cv-ledger', { 'aria-label': M().ledger }, el('strong', { text: `${M().ledger}: ` }), el('span.cv-chips', {},
      chip(M().waitCycles, l.waitCycles), chip(M().byData, l.data), chip(M().byFetch, l.fetch), chip(M().byArb, l.arbitration), chip(M().transactions, l.transactions)));
  }

  /** One cache's counters: the hit rate as a meter, the misses by kind as a bar, and a table of the rest. */
  stats(cache, name) {
    const r = cache.report();
    const pct = r.accesses ? `${(100 * r.hitRate).toFixed(1)} %` : '-';
    const kinds = [['compulsory', r.compulsory], ['capacity', r.capacity], ['conflict', r.conflict]];
    const rows = [[M().accesses, r.accesses], [M().hits, r.hits], [M().misses, r.misses], [M().fills, r.fills], [M().evictions, r.evictions],
      [M().writebacks, r.writebacks], [M().writeThroughs, r.writeThroughs], [M().traffic, `${r.bytesFromNext} / ${r.bytesToNext}`]];
    return el('section.cv-card.cv-stats', { 'aria-label': name },
      el('h3', {}, el('span.cv-name', { text: name }), ' ', el('span.cv-geom', { text: M().geometry(geometry(cache)) })),
      el('div.cv-rate', {}, el('span.cv-rate-k', { text: V.hitRate }), el('span.cv-rate-v.mono', { text: pct }),
        el('meter.cv-meter', { min: 0, max: 1, value: r.accesses ? r.hitRate : 0, 'aria-label': `${V.hitRate}: ${pct}`, title: r.accesses ? V.hitRateOf(r.hits, r.accesses) : V.noAccess })),
      r.misses ? el('span.cv-k', { text: V.missesBy }) : null,
      r.misses ? el('div.cv-stack', { role: 'img', 'aria-label': kinds.map(([k, n]) => `${V.kindNames[k]} ${n}`).join(', ') },
        kinds.filter(([, n]) => n).map(([k, n]) => el(`span.cv-seg.cv-seg-${k}`, { style: `flex: ${n} 1 0`, title: `${V.kinds[k]}: ${n}` }, `${V.kindNames[k]} ${n}`))) : null,
      el('table.mem-stats', {}, el('caption', { text: M().counters }), el('tbody', {}, rows.map(([k, v]) => el('tr', {}, el('th', { scope: 'row', text: k }), el('td.mono', { text: String(v) }))))));
  }

  /** The grid of sets (rows) and ways (columns); the line of the address is outlined. */
  grid(cache, key, f) {
    const rows = lineRows(cache);
    const nSets = cache.nSets;
    const per = this.perPage;
    const pages = Math.ceil(nSets / per);
    if (this.follow && f) this.page[key] = Math.floor(f.index / per);
    const page = Math.min(Math.max(this.page[key], 0), pages - 1);
    this.page[key] = page;
    const first = page * per;
    const last = Math.min(nSets, first + per);
    const ways = cache.cfg.ways;
    const block = cache.cfg.block;
    const fresh = cache.last && cache.last.filled ? cache.last : null;
    const cell = (r) => {
      const now = f?.held && f.index === r.set && f.way === r.way;
      const isFresh = fresh && fresh.set === r.set && fresh.way === r.way;
      const state = !r.valid ? 'empty' : r.dirty ? 'dirty' : 'clean';
      const words = rowWords(r, block);
      const full = rows.filter((q) => q.set === r.set).every((q) => q.valid); // only a full set has a next victim to show
      return el(`td.cv-cell.cv-${state}${now ? '.cv-now' : ''}${isFresh ? '.cv-fresh' : ''}`, { title: V.cellTitle(r.set, r.way, V[state]) },
        el('div.cv-head', {},
          el('span.cv-badge', { text: V.validBadge, title: V.validTitle, class: `cv-badge${r.valid ? ' cv-on' : ''}` }),
          el('span.cv-badge', { text: V.dirtyBadge, title: V.dirtyTitle, class: `cv-badge${r.dirty ? ' cv-on cv-d' : ''}` }),
          r.valid ? el('span.cv-tag.mono', { text: `${M().tag} ${hex(r.tag)}`, title: hex8(r.blockAddr) }) : el('span.cv-tag', { text: V.empty }),
          r.next && ways > 1 && full ? el('span.cv-next', { text: V.nextShort, title: V.next }) : null),
        r.valid ? el('div.cv-words', {}, words.map((w, i) => el(`span.cv-word.mono${now && f.offset >> 2 === i ? '.cv-sel' : ''}`, { text: w }))) : null);
    };
    const body = [];
    for (let s = first; s < last; s++) {
      body.push(el('tr', {}, el('th.cv-set', { scope: 'row', text: V.setLabel(s) }), rows.filter((r) => r.set === s).map(cell)));
    }
    const head = el('tr', {}, el('th', { scope: 'col', text: '' }), Array.from({ length: ways }, (_, w) => el('th', { scope: 'col', text: V.wayLabel(w) })));
    const nav = el('div.cv-nav', {},
      el('button', { type: 'button', text: '◀', 'aria-label': V.prev, title: V.prev, disabled: page === 0, onclick: () => { this.follow = false; this.page[key] -= 1; this.draw(); } }),
      el('span.cv-pages', { text: V.pageOf(first, last - 1, nSets) }),
      el('button', { type: 'button', text: '▶', 'aria-label': V.nextPage, title: V.nextPage, disabled: page >= pages - 1, onclick: () => { this.follow = false; this.page[key] += 1; this.draw(); } }),
      el('label.toggle', {}, `${V.perPage} `, el('select', { 'aria-label': V.perPage, onchange: (e) => { this.perPage = Number(e.target.value); this.draw(); } },
        [8, 16, 32, 64].map((n) => el('option', { value: String(n), text: String(n), selected: n === per })))),
      el('label.toggle', {}, el('input', { type: 'checkbox', checked: this.follow, onchange: (e) => { this.follow = e.target.checked; this.draw(); } }), ` ${V.follow}`));
    return [nav, el('div.cv-gridbox', {}, el('table.cv-grid', { 'aria-label': V.linesTitle }, el('thead', {}, head), el('tbody', {}, body)))];
  }

  /** The page controls and the key on one row, over the grid. */
  withLegend([nav, box]) {
    return [el('div.cv-controls', {}, nav, this.legend()), box];
  }

  legend() {
    const key = (cls, text) => el('span.cv-key', {}, el(`span.cv-swatch.cv-${cls}`), ` ${text}`);
    return el('p.cv-legend', { 'aria-label': V.legend }, key('empty', V.empty), key('clean', V.clean), key('dirty', V.dirty), key('now', V.now), key('fresh', V.fresh));
  }
}
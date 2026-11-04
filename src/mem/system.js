// system.js -- MemorySystem, the facade between the processor models and memory, and MemPort, the
// initiator's view of it (docs/architecture/memory-hierarchy.md §2, phase 1: ideal mode only).
// A port offers sample() (pure, for the combinational evaluation), begin() (accepts a request) and
// commit() (applies it at the clock edge, once). In cache mode (phase 4) a RAM access goes through an L1 cache per
// port, and every change to a cache is journalled so that a model can step back. In ideal mode every access takes one cycle and
// the behaviour is that of the store itself; read() and write() keep the interface of Memory and
// WordMemory, so a model can use a port where it used a store.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { AddressMap, BusError, SPACE } from './bus.js';
import { MainMemory, validateMain } from './timing.js';
import { Controller, newLedger } from './controller.js';
import { Cache, RamLevel, validateCache, DEFAULT_CACHE } from './cache.js';

/** The largest chapter-processor memory: 64 KiB (D2). */
export const MAX_WORDS = 16384;

const hex8 = (a) => '0x' + (a >>> 0).toString(16).padStart(8, '0');

export class MemPort {
  /** @param {MemorySystem} sys @param {'I'|'D'} source @param {AddressMap} map @param {object} store */
  constructor(sys, source, map, store) {
    this.sys = sys;
    this.source = source;
    this.map = map;
    this.store = store;
    this.cache = null; // the L1 cache of this port (cache mode), over the same store
    this.pending = null;
  }

  resolve(addr, size, op) {
    const r = this.map.resolve(addr);
    if (r.unmapped) {
      if (this.map.unmapped === 'zero') return { zero: true };
      throw this.map.fault(addr);
    }
    if (r.region.kind === 'device') {
      if (this.source === 'I' && op === 'read') {
        throw new BusError('fetch', `bus fault: instruction fetch from the device ${r.region.name} at ${hex8(addr)}`, addr >>> 0);
      }
      if (!r.region.target.widths.includes(size)) {
        const why = r.region.target.widthMessage ? ` (${r.region.target.widthMessage})` : '';
        throw new BusError('width', `bus fault: ${r.region.name} does not accept a ${size}-byte access${why}`, addr >>> 0);
      }
    }
    return r;
  }

  /** Value a read would give, with no side effect (devices: peek). Safe to call any number of times. */
  sample(addr, size) {
    const r = this.resolve(addr, size, 'read');
    if (r.zero) return 0;
    if (r.region.kind === 'device') return r.region.target.peek(r.offset, size) ?? 0;
    if (this.cache && r.region.cacheable) return this.cache.debugRead(r.offset, size); // the cache line if present, else RAM
    return r.region.target.read(r.offset, size);
  }

  /** The cache that serves this access, or null (device, uncacheable region, no cache on this port). */
  cacheFor(addr) {
    if (!this.cache) return null;
    const r = this.map.resolve(addr);
    return !r.unmapped && r.region.kind !== 'device' && r.region.cacheable ? { cache: this.cache, offset: r.offset } : null;
  }

  /** Accept a request {op: 'read'|'write', addr, size, data}; nothing changes until commit(). */
  begin(req) {
    if (this.pending) throw new Error('memory port: a request is already pending');
    this.pending = { ...req, ...this.resolve(req.addr, req.size, req.op) };
    return 1; // cycles of the access: ideal memory
  }

  /** Apply the pending request once. Returns {value} for a read, {old} for a write. */
  commit() {
    const q = this.pending;
    if (!q) throw new Error('memory port: no request to commit');
    this.pending = null;
    if (q.zero) return { value: 0, old: 0 };
    const t = q.region.target;
    // a device sees a load at the cycle of the edge and a store one cycle later, when it completes
    const ctx = { cycle: this.sys.clockCycle === null ? this.sys.cycle : this.sys.clockCycle + (q.op === 'write' ? 1 : 0), source: this.source };
    if (q.region.kind === 'device') {
      if (q.op === 'read') return { value: t.read(q.offset, q.size, ctx) >>> 0 };
      t.write(q.offset, q.size, q.data >>> 0, ctx);
      return { old: 0 };
    }
    if (q.op === 'read') return { value: t.read(q.offset, q.size) };
    if (q.region.kind === 'rom') return { old: t.read(q.offset, q.size) }; // a ROM ignores stores
    if (this.cache && q.region.cacheable) {
      const old = this.cache.debugRead(q.offset, q.size);
      this.cache.access('write', q.offset, q.size, q.data >>> 0);
      return { old };
    }
    return { old: t.write(q.offset, q.size, q.data) };
  }

  // The interface of Memory and WordMemory, so that a model can hold a port in place of a store.
  read(addr, size) { return this.sample(addr, size); }

  write(addr, size, value) {
    this.begin({ op: 'write', addr, size, data: value });
    return this.commit().old;
  }

  /** The side effect of a load from a device (a UART pop), once, at the edge; the value was sampled by peek. */
  commitRead(addr, size) {
    const r = this.map.resolve(addr);
    if (r.unmapped || r.region.kind !== 'device') return;
    this.begin({ op: 'read', addr, size });
    this.commit();
  }

  /** Undo of a store (back-step): the RAM is restored directly; devices are restored by the journal. */
  restore(addr, size, old) {
    if (this.cache) return; // cache mode: the journal restores lines and RAM together
    const r = this.map.resolve(addr);
    if (!r.unmapped && r.region.kind === 'ram') r.region.target.write(r.offset, size, old);
  }

  readByte(addr) { return this.sample(addr, 1); }
  writeByte(addr, value) { this.write(addr, 1, value & 0xff); }
  loadBytes(addr, bytes) { this.store.loadBytes(addr, bytes); }
  copyPages() { return this.store.copyPages(); }
  setPages(p) { this.store.setPages(p); }
  /** A store write that is no access (the memory pane): RAM and a matching line, nothing counted. */
  poke(addr, size, value) {
    const c = this.cacheFor(addr);
    if (c) c.cache.debugWrite(c.offset, size, value >>> 0);
    else this.write(addr, size, value);
  }

  /** The words the processor sees: RAM with the lines of this port's cache laid over it. */
  get words() {
    const w = this.store.words;
    if (!this.cache || !w) return w;
    const out = Uint32Array.from(w);
    const c = this.cache;
    for (let set = 0; set < c.nSets; set++) {
      for (const l of c.sets[set].lines) {
        if (!l.valid) continue;
        const base = c.blockAddr(l.tag, set) >>> 2;
        for (let i = 0; i < l.data.length; i += 4) {
          if (base + (i >> 2) < out.length) out[base + (i >> 2)] = (l.data[i] | (l.data[i + 1] << 8) | (l.data[i + 2] << 16) | (l.data[i + 3] << 24)) >>> 0;
        }
      }
    }
    return out;
  }
}

export class MemorySystem {
  /** @param {{unmapped?: 'zero'|'fault'}} options */
  constructor({ unmapped = 'fault' } = {}) {
    this.mode = 'ideal'; // 'ideal': every access takes one cycle; 'main': RAM costs MainMemory.transaction()
    this.unmapped = unmapped;
    this.devices = []; // {base, device}, kept across attach() so that a reset rebuilds the map
    this.cycle = 0;
    this.maps = null;
    this.ports = null;
    this.main = null;
    this.memWords = null;
    this.writeBuffer = 'none';
    this.controller = new Controller(2);
    this.hold = null; // the request in flight: {causes, left}
    this.stats = newLedger();
    this.cacheCfg = { l1i: null, l1d: null };
    this.caches = { I: null, D: null };
    this.log = []; // undo functions of the cache changes, newest last (§8)
    this.logBase = 0; // number of entries dropped from the front of the log
    this.logLimit = 400_000;
    this.platform = null; // the platform of GPIO, timer and UART, when the models are given one (setPlatform)
    this.clockCycle = null; // the model's own cycle, set by edge(); the ISS sets cycle instead
    this.curHold = null; // the record of the edge in progress: the first change of a device saves its state there
  }

  /**
   * The platform devices on this system, for the processor models (the instruction-level profile iss-priv has its own).
   * Each model calls edge() at every clock edge: the devices are told the time, and the state a device had before
   * the edge is kept in the edge's record, so that a step back restores it.
   */
  setPlatform(platform) {
    this.platform = platform;
    platform.setJournal({ touch: () => { if (this.curHold && this.curHold.dev === undefined) this.curHold.dev = platform.snapshot(); } });
    for (const { base, device } of platform.devices()) this.addDevice(base, device);
  }

  /** Does the system need the model's attention at every edge: waits for memory, or devices that keep time? */
  get active() { return this.timed || this.devices.length > 0; }

  /** Start of a clock edge at the model's cycle: the record to keep (for load()), devices ticked to this cycle. */
  edge(cycle) {
    const s = this.save();
    this.curHold = s;
    this.clockCycle = cycle;
    if (this.devices.length) this.tickDevices(cycle);
    return s;
  }

  /** What follows changes the devices outside any edge (a pin set from the interface): it belongs to no step. */
  detach() { this.curHold = null; }

  get timed() { return this.mode !== 'ideal'; }

  /**
   * Set the memory mode. `main` is {overhead, readLatency, writeLatency, busWidth}; `ports` is 1 or 2.
   * An invalid configuration is not activated: returns {ok: false, messages}. Changing the
   * configuration is for a reset of the run (the models reset after it).
   */
  configure({ mode = 'ideal', main = null, ports = 2, l1i = null, l1d = null, words = null, writeBuffer = 'none' } = {}) {
    const messages = [];
    if (!['ideal', 'main', 'cache'].includes(mode)) messages.push(`unknown memory mode ${mode}`);
    if (words !== null && !(Number.isInteger(words) && words >= 64 && words <= MAX_WORDS && (words & (words - 1)) === 0)) {
      messages.push(`words must be a power of two from 64 to ${MAX_WORDS}`);
    }
    if (writeBuffer !== 'none' && writeBuffer !== 'ideal') messages.push('writeBuffer must be none or ideal');
    if (ports !== 1 && ports !== 2) messages.push('ports must be 1 or 2');
    if (mode !== 'ideal') messages.push(...validateMain(main ?? {}));
    if (mode === 'cache') {
      if (!l1i && !l1d) messages.push('cache mode needs an instruction cache, a data cache, or both');
      for (const [k, c] of [['l1i', l1i], ['l1d', l1d]]) if (c) messages.push(...validateCache(c).map((m) => `${k}: ${m}`));
    }
    if (messages.length) return { ok: false, messages };
    this.mode = mode;
    this.memWords = words; // size of the chapter processors' memories in words (null: the profile's 256)
    this.writeBuffer = writeBuffer; // 'ideal': stores and write-backs are absorbed, as the book's rvcache.py assumes (D5)
    this.cacheCfg = mode === 'cache' ? { l1i: l1i && { ...DEFAULT_CACHE, ...l1i }, l1d: l1d && { ...DEFAULT_CACHE, ...l1d } } : { l1i: null, l1d: null };
    this.main = mode !== 'ideal' ? new MainMemory(main) : null;
    this.controller = new Controller(ports);
    this.hold = null;
    this.stats = newLedger();
    return { ok: true, messages };
  }

  /** Cycles one access of `size` bytes at `addr` takes (a fault costs 1: the access itself raises it). */
  accessCycles(source, op, addr, size) {
    if (!this.timed) return 1;
    const map = this.ports[source].map;
    const r = map.resolve(addr);
    if (r.unmapped) return 1;
    if (r.region.kind === 'device') return Math.max(1, r.region.target.latency[op]);
    const c = this.ports[source].cacheFor(addr);
    if (c) return this.cacheCycles(c.cache, op, c.offset, size);
    return Math.max(1, this.main.transaction(size, op));
  }

  /** hit + (dirty victim: write the block) + (fill: read the block) + (write-through: write the word), §6. */
  cacheCycles(cache, op, offset, size) {
    const p = cache.plan(op, offset, size);
    const { block, hit } = cache.cfg;
    let n = hit;
    const absorbed = this.writeBuffer === 'ideal';
    if (p.victim?.dirty && !absorbed) n += this.main.transaction(block, 'write');
    if (p.fill) n += this.main.transaction(block, 'read');
    if (p.writeThrough && !absorbed) n += this.main.transaction(size, 'write');
    return Math.max(1, n);
  }

  /** Counted read accesses of the edge in which the requests complete (stores are counted by the port's write). */
  commitReads(reqs) {
    for (const src of ['I', 'D']) {
      const q = reqs[src];
      if (!q || q.op !== 'read') continue;
      const c = this.ports[src].cacheFor(q.addr);
      if (c) c.cache.access('read', c.offset, q.size);
    }
  }

  /**
   * Called once per clock edge by a model, with the requests that edge needs: {I?, D?}, each
   * {op, addr, size}. Returns the cause ('data' | 'fetch' | 'arbitration') when this edge is a wait
   * edge (the model holds all its state and returns), or null when the access completes in this
   * edge (the model performs it). A request in flight is held, so it counts one transaction however
   * many wait edges it takes, and a device side effect runs once (at the commit of the edge).
   */
  waitEdge(reqs) {
    if (!this.timed) return null;
    this.cycle += 1;
    if (!this.hold) {
      const cycles = {};
      for (const src of ['I', 'D']) if (reqs[src]) cycles[src] = this.accessCycles(src, reqs[src].op, reqs[src].addr, reqs[src].size);
      this.hold = { causes: this.controller.plan(cycles), left: 0 };
      this.hold.left = this.hold.causes.length;
    }
    const h = this.hold;
    if (h.left > 0) {
      const cause = h.causes[h.causes.length - h.left];
      h.left -= 1;
      this.stats.waitCycles += 1;
      this.stats[cause] += 1;
      return cause;
    }
    this.hold = null;
    this.commitReads(reqs);
    for (const src of ['I', 'D']) {
      if (!reqs[src]) continue;
      this.stats.transactions += 1;
      this.stats.bytes += reqs[src].size;
    }
    return null;
  }

  /** State of the controller before an edge, for the model's history record (back-step). */
  save() {
    return { cycle: this.cycle, hold: this.hold && { causes: this.hold.causes, left: this.hold.left }, stats: { ...this.stats },
      mark: this.logBase + this.log.length };
  }

  /** Undo every cache change made since save() returned s, then restore the controller. */
  load(s) {
    while (this.logBase + this.log.length > s.mark && this.log.length) this.log.pop()();
    this.cycle = s.cycle;
    this.hold = s.hold && { causes: s.hold.causes, left: s.hold.left };
    this.stats = { ...s.stats };
    if (s.dev !== undefined && this.platform) this.platform.restore(s.dev);
    this.curHold = null;
  }

  /** Register a device at `base`; also on a map already attached. */
  addDevice(base, device) {
    this.devices.push({ base, device });
    if (this.maps) for (const m of this.maps) this.register(m, base, device);
  }

  register(map, base, device) {
    map.register({ name: device.name, base, size: device.size, kind: 'device', window: device.window, target: device });
  }

  /** Tell every device the time: the absolute CPU cycle (one tick per clock edge in the models, per instruction in the ISS). */
  tickDevices(cycle) {
    for (const { device } of this.devices) device.tick(cycle);
  }

  /**
   * Build the address map(s) over the model's stores and return its ports. The instruction-side
   * store and the data-side store are one memory (one map, as the ISS and the multicycle model) or
   * two (Harvard: two maps; devices appear in both, a fetch from one is a bus fault). Called at each
   * reset of the model, which also resets the devices.
   */
  attach(imem, dmem, { caches = true } = {}) {
    const maps = new Set();
    const mapFor = (store) => {
      const map = new AddressMap({ unmapped: this.unmapped });
      if (store.words) map.register({ name: 'ram', base: 0, size: store.words.length * 4, kind: 'ram', wrap: true, target: store });
      else map.register({ name: 'ram', base: 0, size: SPACE, kind: 'ram', target: store });
      maps.add(map);
      return map;
    };
    const dmap = mapFor(dmem);
    const imap = imem === dmem ? dmap : mapFor(imem);
    this.maps = [...maps];
    this.cycle = 0;
    this.hold = null;
    this.stats = newLedger();
    for (const { base, device } of this.devices) {
      device.reset();
      for (const m of this.maps) this.register(m, base, device);
    }
    this.ports = { I: new MemPort(this, 'I', imap, imem), D: new MemPort(this, 'D', dmap, dmem) };
    this.log = [];
    this.logBase = 0;
    this.caches = { I: null, D: null };
    if (caches && this.mode === 'cache') {
      const levels = new Map(); // one RamLevel per store: a unified memory is shared by both caches
      const level = (s) => levels.get(s) ?? levels.set(s, new RamLevel(s)).get(s);
      const undo = (fn) => {
        this.log.push(fn);
        if (this.log.length > this.logLimit) { this.log.splice(0, this.logLimit / 4); this.logBase += this.logLimit / 4; }
      };
      for (const [src, cfg, store, name] of [['I', this.cacheCfg.l1i, imem, 'L1I'], ['D', this.cacheCfg.l1d, dmem, 'L1D']]) {
        if (!cfg) continue;
        const c = new Cache(cfg, level(store), name);
        c.onUndo = undo;
        this.caches[src] = c;
        this.ports[src].cache = c;
      }
    }
    return this.ports;
  }

  /** Counters of the caches (and the controller's ledger): {I, D, ledger}. */
  report() {
    return { I: this.caches.I?.report() ?? null, D: this.caches.D?.report() ?? null, ledger: { ...this.stats } };
  }
}

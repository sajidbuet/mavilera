// share.js -- the program with its view and settings, in a versioned format
// (WS-F-122, WS-F-144, WS-N-013): as a link whose fragment (after '#', never
// sent to the server) holds the state compressed with deflate and written in
// base64url, and as a downloadable settings file (JSON) that also carries a
// program too long for a link. An older or unknown version is refused with a
// message; nothing is guessed. Pure JavaScript (CompressionStream where the
// platform has it; without it the link is written uncompressed). What a state may hold is the architecture's
// (src/shell/share-schema.js, from its descriptor): `createShare(schema)` gives the functions for it.
// Version 2 (v10 draft, pico2 P1-F1, research D31 Q5): a project ({project, files, entry}) of an architecture with
// capability `projects`; a single program is still written as version 1, and both versions are read.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readConfig } from '../mem/config.js';
import { FILE_NAME, LIMITS, projectName } from './project.js';

/** The version a single-program state is written in (unchanged since W-D29, so every released module writes it). */
export const SHARE_VERSION = 1;
/** v10 draft (pico2 P1-F1, research D31 Q5): a project state, with `files` and `entry`, is written as version 2. */
export const SHARE_VERSION_PROJECT = 2;
const READS = [SHARE_VERSION, SHARE_VERSION_PROJECT];
export const FILE_FORMAT = 'risc-vista-settings';
/** Longest fragment written into a link; a longer state is offered as a settings file (WS-N-013). */
export const LINK_LIMIT = 8000;

// W-D29 decision 4: a link or file without an architecture was written before there were others, for RISC-V
const FIRST_ARCH = 'riscv';

export class ShareError extends Error {
  /** @param {string} code 'format' | 'version' | 'corrupt' | 'field' | 'arch'  @param {object} data */
  constructor(code, message, data = {}) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

/**
 * The state to share, checked against the schema S: {arch, view, profile, subset, lang, name, source, cc: {the extra
 * language's options}, then each view setting under its key (RISC-V: pipe: {hazard, predictor, entries, resolution})}.
 * Unknown keys are dropped.
 */
function normalise(S, s, version = s?.files ? SHARE_VERSION_PROJECT : SHARE_VERSION) {
  const pick = (v, list, field) => {
    if (v === undefined || v === null) return null;
    if (!list.includes(v)) throw new ShareError('field', `unknown ${field} ${JSON.stringify(v)}`, { field });
    return v;
  };
  // the architecture (W-D29 decision 4): a link or file without one is RISC-V's, as before; another is refused
  const archId = s?.arch ?? FIRST_ARCH;
  if (archId !== S.arch) throw new ShareError('arch', `made for the architecture ${JSON.stringify(String(archId))}`, { arch: String(archId) });
  // version 2: a project; its entry's text is also `source`, so that whatever reads one program reads the entry
  const project = version === SHARE_VERSION_PROJECT ? normaliseProject(S, s) : null;
  if (project) s = { ...s, source: project.files.find((f) => f.name === project.entry).text, name: project.entry };
  if (typeof s?.source !== 'string') throw new ShareError('field', 'no program text', { field: 'source' });
  // contract v9: a profile of another variant is read before the view, whose list is this variant's; the page
  // reloads in that variant and reads the state there
  const profile = pick(s.profile, S.profiles, 'profile') ?? S.defaultProfile ?? S.profiles[0];
  const variant = S.variantOf?.[profile] ?? null;
  if (variant !== (S.activeVariant ?? null)) throw new ShareError('variant', `made for the profile ${JSON.stringify(profile)} of another instruction set`, { profile, variant });
  const out = {
    arch: S.arch,
    view: pick(s.view, S.views, 'view') ?? S.views[0],
    profile,
    subset: pick(s.subset, S.subsets, 'subset'),
    lang: pick(s.lang, S.langs, 'lang') ?? 'asm',
    name: typeof s.name === 'string' && /^[\w.-]{1,64}$/.test(s.name) ? s.name : null,
    source: s.source,
  };
  if (s.cc && S.options.length) out.cc = Object.fromEntries(S.options.map(([k, list]) => [k, pick(s.cc[k], list, `cc.${k}`)]));
  // v10 draft (pico2 P1-M4): the module's build options; optional, so that a link written before them reads with the defaults
  if (s.opts && S.buildOptions?.length) out.opts = Object.fromEntries(S.buildOptions.map(([k, list]) => [k, pick(s.opts[k], list, `opts.${k}`)]));
  for (const [key, fields] of S.settings) {
    if (s[key]) out[key] = Object.fromEntries(fields.map(([k, list]) => [k, pick(s[key][k], list, `${key}.${k}`)]));
  }
  // v10 draft (pico2 P1-M4, research D36 Q5): the inputs given during the run (Engine.inputs), replayed at their cycles
  if (S.inputs && Array.isArray(s.inputs) && s.inputs.length) out.inputs = normaliseInputs(s.inputs);
  // the memory model (M7): optional, so that a file or link of an earlier version still reads, as ideal memory
  if (s.mem) out.mem = readConfig(s.mem);
  // the platform script and settings (M7 devices): optional as well
  if (s.platform) out.platform = normalisePlatform(s.platform);
  // v10 draft (Language.companion, research D43): a single program's companion file (pico2: its .pio file)
  if (s.companion && !project) out.companion = normaliseCompanion(S, s.companion);
  if (project) Object.assign(out, project);
  return out;
}

/** v10 draft (research D43): the companion file of a single-program state, {name, text}: a flat name with the companion's extension. */
function normaliseCompanion(S, c) {
  if (!S.companion) throw new ShareError('field', 'this architecture has no companion file', { field: 'companion' });
  const name = c?.name;
  if (typeof name !== 'string' || !FILE_NAME.test(name) || !name.toLowerCase().endsWith(S.companion)) throw new ShareError('field', `companion file name ${JSON.stringify(String(name))}`, { field: 'companion' });
  if (typeof c.text !== 'string') throw new ShareError('field', `no text for ${name}`, { field: 'companion' });
  if (new TextEncoder().encode(c.text).length > LIMITS.bytes) throw new ShareError('field', 'the companion file is too large', { field: 'companion' });
  return { name, text: c.text };
}

/**
 * The project of a version-2 state: {project, files: [{name, text}], entry}, checked with the rules of project.js
 * (flat names, this architecture's extensions, no duplicates, 64 files, 2 MiB). Refused where the architecture has no
 * projects.
 */
function normaliseProject(S, s) {
  if (!S.projects) throw new ShareError('field', 'this architecture does not open projects', { field: 'files' });
  if (!Array.isArray(s.files) || s.files.length === 0) throw new ShareError('field', 'a project link without files', { field: 'files' });
  if (s.files.length > LIMITS.files) throw new ShareError('field', `more than ${LIMITS.files} files`, { field: 'files' });
  const seen = new Set();
  let bytes = 0;
  const files = s.files.map((f) => {
    const name = f?.name;
    const ext = typeof name === 'string' && name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
    if (typeof name !== 'string' || !FILE_NAME.test(name) || !S.extensions.includes(ext)) throw new ShareError('field', `file name ${JSON.stringify(String(name))}`, { field: 'files' });
    if (seen.has(name)) throw new ShareError('field', `two files named ${name}`, { field: 'files' });
    if (typeof f.text !== 'string') throw new ShareError('field', `no text for ${name}`, { field: 'files' });
    seen.add(name);
    bytes += new TextEncoder().encode(f.text).length;
    return { name, text: f.text };
  });
  if (bytes > LIMITS.bytes) throw new ShareError('field', 'the project is too large', { field: 'files' });
  const entry = s.entry ?? files[0].name;
  if (!seen.has(entry)) throw new ShareError('field', `the entry ${JSON.stringify(String(entry))} is not a file of the project`, { field: 'entry' });
  return { project: projectName(s.project ?? 'Shared project'), files, entry };
}

const MAX_EVENTS = 500; // a script longer than this is cut: a link is limited in size (WS-N-013)
export const MAX_INPUTS = 2000; // inputs of a run kept in a link or settings file (P1-M4); a longer log is refused

/**
 * The inputs of a run (contract v8 Engine.inputs; pico2 P1-M4): [{cycle, step, kind: 'pin', pin, level} | {…, kind: 'uart', uart,
 * bytes}], checked field by field, in cycle order. Anything else in an entry is dropped; a malformed entry refuses the state.
 */
export function normaliseInputs(list) {
  if (list.length > MAX_INPUTS) throw new ShareError('field', `more than ${MAX_INPUTS} inputs`, { field: 'inputs' });
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  return list.map((e) => {
    const base = { cycle: e?.cycle, step: e?.step };
    if (!int(base.cycle, 0, Number.MAX_SAFE_INTEGER) || !int(base.step, 0, Number.MAX_SAFE_INTEGER)) throw new ShareError('field', 'an input without its cycle and step', { field: 'inputs' });
    if (e.kind === 'pin' && int(e.pin, 0, 47) && [1, 0, -1].includes(e.level)) return { ...base, kind: 'pin', pin: e.pin, level: e.level };
    if (e.kind === 'uart' && int(e.uart, 0, 1) && Array.isArray(e.bytes) && e.bytes.length <= 4096 && e.bytes.every((b) => int(b, 0, 255))) {
      return { ...base, kind: 'uart', uart: e.uart, bytes: e.bytes.slice() };
    }
    throw new ShareError('field', `not an input: ${JSON.stringify(e).slice(0, 80)}`, { field: 'inputs' });
  }).sort((a, b) => a.cycle - b.cycle);
}

/**
 * The platform setting, checked: pin events {cycle, mask, value} and received bytes {cycle, byte} in cycle order,
 * the MTIME divider, the cycles to take a trap, and the two switches of rvsim.py --priv. Anything else is dropped.
 */
export function normalisePlatform(p) {
  const int = (v, lo, hi, dflt) => (Number.isInteger(v) && v >= lo && v <= hi ? v : dflt);
  const events = (list, keys) => (Array.isArray(list) ? list : []).slice(0, MAX_EVENTS)
    .map((e) => ({ cycle: int(e?.cycle, 0, 2 ** 40, -1), ...Object.fromEntries(keys.map((k) => [k, int(e?.[k], 0, 0xffffffff, 0)])) }))
    .filter((e) => e.cycle >= 0).sort((a, b) => a.cycle - b.cycle);
  return {
    stimulus: events(p.stimulus, ['mask', 'value']), rx: events(p.rx, ['byte']).map((e) => ({ ...e, byte: e.byte & 0xff })),
    mtimeDiv: int(p.mtimeDiv, 1, 1_000_000, 1), trapEntry: int(p.trapEntry, 0, 1000, 3),
    mtvalZero: Boolean(p.mtvalZero), trapCheck: Boolean(p.trapCheck), uart: p.uart !== false, txCycles: int(p.txCycles, 1, 1000, 4),
    npu: p.npu !== false, npuStop: Boolean(p.npuStop), // the Chapter 11 NPU at 0x5000_0000 (decisions G1, G5)
    gpu: Boolean(p.gpu), // the SIMT core at 0x5000_1000: on the CPU + GPU tool's pages only (GPU-7, decision G30)
  };
}

export const defaultPlatform = () => normalisePlatform({});

// --- base64url and deflate ---------------------------------------------------------------
function toB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new ShareError('corrupt', 'the link is damaged (characters outside base64url)');
  let s;
  try { s = atob(text.replace(/-/g, '+').replace(/_/g, '/')); } catch { throw new ShareError('corrupt', 'the link is damaged (base64url)'); }
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function pipeThrough(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const canDeflate = () => typeof CompressionStream === 'function';

// --- links -------------------------------------------------------------------------------
/**
 * The fragment for a state, without '#': 'rv1z.<base64url of deflate-raw(JSON)>', or
 * 'rv1.<base64url of JSON>' where the platform cannot compress.
 */
async function encodeFragment(S, state, { compress = canDeflate() } = {}) {
  const v = state?.files ? SHARE_VERSION_PROJECT : SHARE_VERSION;
  const n = normalise(S, state, v);
  if (v === SHARE_VERSION_PROJECT) delete n.source; // the entry's text is in `files`; reading the link restores `source`
  const json = new TextEncoder().encode(JSON.stringify(n));
  if (!compress) return `rv${v}.${toB64url(json)}`;
  return `rv${v}z.${toB64url(await pipeThrough(json, new CompressionStream('deflate-raw')))}`;
}

/** Whether a fragment is meant for this format at all (any version), so that it is read or refused. */
export function isShareFragment(fragment) {
  return /^#?rv\d+z?\./.test(fragment ?? '');
}

/** The state of a fragment (with or without '#'). Throws ShareError for another version or a damaged link. */
async function decodeFragment(S, fragment) {
  const m = /^#?rv(\d+)(z?)\.(.*)$/s.exec(fragment ?? '');
  if (!m) throw new ShareError('format', 'not a MAVILERA link');
  const version = Number(m[1]);
  if (!READS.includes(version)) throw new ShareError('version', `link format version ${version}; this version reads ${READS.join(' and ')}`, { version });
  let bytes = fromB64url(m[3]);
  if (m[2]) {
    if (!canDeflate()) throw new ShareError('corrupt', 'this browser cannot decompress the link');
    try { bytes = await pipeThrough(bytes, new DecompressionStream('deflate-raw')); } catch { throw new ShareError('corrupt', 'the link is damaged (deflate)'); }
  }
  let obj;
  try { obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new ShareError('corrupt', 'the link is damaged (JSON)'); }
  return normalise(S, obj, version);
}

// --- settings file -------------------------------------------------------------------------
/** The settings file: JSON with the format name and version first. */
function settingsFile(S, state) {
  const v = state?.files ? SHARE_VERSION_PROJECT : SHARE_VERSION;
  const n = normalise(S, state, v);
  if (v === SHARE_VERSION_PROJECT) delete n.source;
  return `${JSON.stringify({ format: FILE_FORMAT, version: v, ...n }, null, 2)}\n`;
}

/** The state of a settings file. Throws ShareError for another format or version. */
function readSettingsFile(S, text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new ShareError('corrupt', 'not a JSON file'); }
  if (obj?.format !== FILE_FORMAT) throw new ShareError('format', 'not a MAVILERA settings file');
  if (!READS.includes(obj.version)) throw new ShareError('version', `settings file version ${obj.version}; this version reads ${READS.join(' and ')}`, { version: obj.version });
  return normalise(S, obj, obj.version);
}

/** The functions of this format for an architecture: its schema (src/shell/share-schema.js) bound. */
export function createShare(S) {
  return {
    normalise: (s, version) => normalise(S, s, version),
    encodeFragment: (state, options) => encodeFragment(S, state, options),
    decodeFragment: (fragment) => decodeFragment(S, fragment),
    settingsFile: (state) => settingsFile(S, state),
    readSettingsFile: (text) => readSettingsFile(S, text),
  };
}

// share.js -- the program with its view and settings, in a versioned format
// (WS-F-122, WS-F-144, WS-N-013): as a link whose fragment (after '#', never
// sent to the server) holds the state compressed with deflate and written in
// base64url, and as a downloadable settings file (JSON) that also carries a
// program too long for a link. An older or unknown version is refused with a
// message; nothing is guessed. Pure JavaScript (CompressionStream where the
// platform has it; without it the link is written uncompressed). What a state may hold is the architecture's
// (src/shell/share-schema.js, from its descriptor): `createShare(schema)` gives the functions for it.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readConfig } from '../mem/config.js';

export const SHARE_VERSION = 1;
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
function normalise(S, s) {
  const pick = (v, list, field) => {
    if (v === undefined || v === null) return null;
    if (!list.includes(v)) throw new ShareError('field', `unknown ${field} ${JSON.stringify(v)}`, { field });
    return v;
  };
  // the architecture (W-D29 decision 4): a link or file without one is RISC-V's, as before; another is refused
  const archId = s?.arch ?? FIRST_ARCH;
  if (archId !== S.arch) throw new ShareError('arch', `made for the architecture ${JSON.stringify(String(archId))}`, { arch: String(archId) });
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
  for (const [key, fields] of S.settings) {
    if (s[key]) out[key] = Object.fromEntries(fields.map(([k, list]) => [k, pick(s[key][k], list, `${key}.${k}`)]));
  }
  // the memory model (M7): optional, so that a file or link of an earlier version still reads, as ideal memory
  if (s.mem) out.mem = readConfig(s.mem);
  // the platform script and settings (M7 devices): optional as well
  if (s.platform) out.platform = normalisePlatform(s.platform);
  return out;
}

const MAX_EVENTS = 500; // a script longer than this is cut: a link is limited in size (WS-N-013)

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
  const json = new TextEncoder().encode(JSON.stringify(normalise(S, state)));
  if (!compress) return `rv${SHARE_VERSION}.${toB64url(json)}`;
  return `rv${SHARE_VERSION}z.${toB64url(await pipeThrough(json, new CompressionStream('deflate-raw')))}`;
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
  if (version !== SHARE_VERSION) throw new ShareError('version', `link format version ${version}; this version reads ${SHARE_VERSION}`, { version });
  let bytes = fromB64url(m[3]);
  if (m[2]) {
    if (!canDeflate()) throw new ShareError('corrupt', 'this browser cannot decompress the link');
    try { bytes = await pipeThrough(bytes, new DecompressionStream('deflate-raw')); } catch { throw new ShareError('corrupt', 'the link is damaged (deflate)'); }
  }
  let obj;
  try { obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new ShareError('corrupt', 'the link is damaged (JSON)'); }
  return normalise(S, obj);
}

// --- settings file -------------------------------------------------------------------------
/** The settings file: JSON with the format name and version first. */
function settingsFile(S, state) {
  return `${JSON.stringify({ format: FILE_FORMAT, version: SHARE_VERSION, ...normalise(S, state) }, null, 2)}\n`;
}

/** The state of a settings file. Throws ShareError for another format or version. */
function readSettingsFile(S, text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new ShareError('corrupt', 'not a JSON file'); }
  if (obj?.format !== FILE_FORMAT) throw new ShareError('format', 'not a MAVILERA settings file');
  if (obj.version !== SHARE_VERSION) throw new ShareError('version', `settings file version ${obj.version}; this version reads ${SHARE_VERSION}`, { version: obj.version });
  return normalise(S, obj);
}

/** The functions of this format for an architecture: its schema (src/shell/share-schema.js) bound. */
export function createShare(S) {
  return {
    normalise: (s) => normalise(S, s),
    encodeFragment: (state, options) => encodeFragment(S, state, options),
    decodeFragment: (fragment) => decodeFragment(S, fragment),
    settingsFile: (state) => settingsFile(S, state),
    readSettingsFile: (text) => readSettingsFile(S, text),
  };
}

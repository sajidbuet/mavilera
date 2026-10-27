// share.js -- the program with its view and settings, in a versioned format
// (WS-F-122, WS-F-144, WS-N-013): as a link whose fragment (after '#', never
// sent to the server) holds the state compressed with deflate and written in
// base64url, and as a downloadable settings file (JSON) that also carries a
// program too long for a link. An older or unknown version is refused with a
// message; nothing is guessed. Pure JavaScript (CompressionStream where the
// platform has it; without it the link is written uncompressed).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const SHARE_VERSION = 1;
export const FILE_FORMAT = 'risc-vista-settings';
/** Longest fragment written into a link; a longer state is offered as a settings file (WS-N-013). */
export const LINK_LIMIT = 8000;

const VIEWS = ['isa', 'single', 'multi', 'pipe', 'compare'];
const PROFILES = ['iss', 'ch06', 'ch07', 'ch08'];
const LANGS = ['asm', 'c'];

export class ShareError extends Error {
  /** @param {string} code 'format' | 'version' | 'corrupt' | 'field'  @param {object} data */
  constructor(code, message, data = {}) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

/**
 * The state to share, checked: {view, profile, subset, lang, name, source, cc: {mode, march},
 * pipe: {hazard, predictor, entries, resolution}}. Unknown keys are dropped.
 */
export function normalise(s) {
  const pick = (v, list, field) => {
    if (v === undefined || v === null) return null;
    if (!list.includes(v)) throw new ShareError('field', `unknown ${field} ${JSON.stringify(v)}`, { field });
    return v;
  };
  if (typeof s?.source !== 'string') throw new ShareError('field', 'no program text', { field: 'source' });
  const out = {
    view: pick(s.view, VIEWS, 'view') ?? 'isa',
    profile: pick(s.profile, PROFILES, 'profile') ?? 'iss',
    subset: pick(s.subset, ['full', 'lab', 'ext'], 'subset'),
    lang: pick(s.lang, LANGS, 'lang') ?? 'asm',
    name: typeof s.name === 'string' && /^[\w.-]{1,64}$/.test(s.name) ? s.name : null,
    source: s.source,
  };
  if (s.cc) out.cc = { mode: pick(s.cc.mode, ['plain', 'register'], 'cc.mode'), march: pick(s.cc.march, ['rv32im', 'rv32i'], 'cc.march') };
  if (s.pipe) {
    const e = s.pipe.entries;
    if (e !== undefined && ![2, 4, 8, 16, 32, 64].includes(e)) throw new ShareError('field', `unknown pipe.entries ${JSON.stringify(e)}`, { field: 'pipe.entries' });
    out.pipe = { hazard: pick(s.pipe.hazard, ['full', 'stall', 'memwb', 'mem', 'none'], 'pipe.hazard'),
      predictor: pick(s.pipe.predictor, ['none', '1bit', '2bit'], 'pipe.predictor'), entries: e ?? null,
      resolution: pick(s.pipe.resolution, ['ex', 'id'], 'pipe.resolution') };
  }
  return out;
}

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
export async function encodeFragment(state, { compress = canDeflate() } = {}) {
  const json = new TextEncoder().encode(JSON.stringify(normalise(state)));
  if (!compress) return `rv${SHARE_VERSION}.${toB64url(json)}`;
  return `rv${SHARE_VERSION}z.${toB64url(await pipeThrough(json, new CompressionStream('deflate-raw')))}`;
}

/** Whether a fragment is meant for this format at all (any version), so that it is read or refused. */
export function isShareFragment(fragment) {
  return /^#?rv\d+z?\./.test(fragment ?? '');
}

/** The state of a fragment (with or without '#'). Throws ShareError for another version or a damaged link. */
export async function decodeFragment(fragment) {
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
  return normalise(obj);
}

// --- settings file -------------------------------------------------------------------------
/** The settings file: JSON with the format name and version first. */
export function settingsFile(state) {
  return `${JSON.stringify({ format: FILE_FORMAT, version: SHARE_VERSION, ...normalise(state) }, null, 2)}\n`;
}

/** The state of a settings file. Throws ShareError for another format or version. */
export function readSettingsFile(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new ShareError('corrupt', 'not a JSON file'); }
  if (obj?.format !== FILE_FORMAT) throw new ShareError('format', 'not a MAVILERA settings file');
  if (obj.version !== SHARE_VERSION) throw new ShareError('version', `settings file version ${obj.version}; this version reads ${SHARE_VERSION}`, { version: obj.version });
  return normalise(obj);
}

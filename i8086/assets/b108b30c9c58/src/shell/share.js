// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { readConfig } from '../mem/config.js';
import { FILE_NAME, LIMITS, projectName } from './project.js';
export const SHARE_VERSION = 1;
export const SHARE_VERSION_PROJECT = 2;
const READS = [SHARE_VERSION, SHARE_VERSION_PROJECT];
export const FILE_FORMAT = 'risc-vista-settings';
export const LINK_LIMIT = 8000;
const FIRST_ARCH = 'riscv';
export class ShareError extends Error {
 constructor(code, message, data = {}) {
 super(message);
 this.code = code;
 this.data = data;
 }
}
function normalise(S, s, version = s?.files ? SHARE_VERSION_PROJECT : SHARE_VERSION) {
 const pick = (v, list, field) => {
 if (v === undefined || v === null) return null;
 if (!list.includes(v)) throw new ShareError('field', `unknown ${field} ${JSON.stringify(v)}`, { field });
 return v;
 };
 const archId = s?.arch ?? FIRST_ARCH;
 if (archId !== S.arch) throw new ShareError('arch', `made for the architecture ${JSON.stringify(String(archId))}`, { arch: String(archId) });
 const project = version === SHARE_VERSION_PROJECT ? normaliseProject(S, s) : null;
 if (project) s = { ...s, source: project.files.find((f) => f.name === project.entry).text, name: project.entry };
 if (typeof s?.source !== 'string') throw new ShareError('field', 'no program text', { field: 'source' });
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
 if (s.opts && S.buildOptions?.length) out.opts = Object.fromEntries(S.buildOptions.map(([k, list]) => [k, pick(s.opts[k], list, `opts.${k}`)]));
 for (const [key, fields] of S.settings) {
 if (s[key]) out[key] = Object.fromEntries(fields.map(([k, list]) => [k, pick(s[key][k], list, `${key}.${k}`)]));
 }
 if (S.inputs && Array.isArray(s.inputs) && s.inputs.length) out.inputs = normaliseInputs(s.inputs);
 if (s.mem) out.mem = readConfig(s.mem);
 if (s.platform) out.platform = normalisePlatform(s.platform);
 if (s.companion && !project) out.companion = normaliseCompanion(S, s.companion);
 if (project) Object.assign(out, project);
 return out;
}
function normaliseCompanion(S, c) {
 if (!S.companion) throw new ShareError('field', 'this architecture has no companion file', { field: 'companion' });
 const name = c?.name;
 if (typeof name !== 'string' || !FILE_NAME.test(name) || !name.toLowerCase().endsWith(S.companion)) throw new ShareError('field', `companion file name ${JSON.stringify(String(name))}`, { field: 'companion' });
 if (typeof c.text !== 'string') throw new ShareError('field', `no text for ${name}`, { field: 'companion' });
 if (new TextEncoder().encode(c.text).length > LIMITS.bytes) throw new ShareError('field', 'the companion file is too large', { field: 'companion' });
 return { name, text: c.text };
}
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
const MAX_EVENTS = 500;
export const MAX_INPUTS = 2000;
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
export function normalisePlatform(p) {
 const int = (v, lo, hi, dflt) => (Number.isInteger(v) && v >= lo && v <= hi ? v : dflt);
 const events = (list, keys) => (Array.isArray(list) ? list : []).slice(0, MAX_EVENTS)
 .map((e) => ({ cycle: int(e?.cycle, 0, 2 ** 40, -1), ...Object.fromEntries(keys.map((k) => [k, int(e?.[k], 0, 0xffffffff, 0)])) }))
 .filter((e) => e.cycle >= 0).sort((a, b) => a.cycle - b.cycle);
 return {
 stimulus: events(p.stimulus, ['mask', 'value']), rx: events(p.rx, ['byte']).map((e) => ({ ...e, byte: e.byte & 0xff })),
 mtimeDiv: int(p.mtimeDiv, 1, 1_000_000, 1), trapEntry: int(p.trapEntry, 0, 1000, 3),
 mtvalZero: Boolean(p.mtvalZero), trapCheck: Boolean(p.trapCheck), uart: p.uart !== false, txCycles: int(p.txCycles, 1, 1000, 4),
 npu: p.npu !== false, npuStop: Boolean(p.npuStop),
 gpu: Boolean(p.gpu),
 };
}
export const defaultPlatform = () => normalisePlatform({});
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
async function encodeFragment(S, state, { compress = canDeflate() } = {}) {
 const v = state?.files ? SHARE_VERSION_PROJECT : SHARE_VERSION;
 const n = normalise(S, state, v);
 if (v === SHARE_VERSION_PROJECT) delete n.source;
 const json = new TextEncoder().encode(JSON.stringify(n));
 if (!compress) return `rv${v}.${toB64url(json)}`;
 return `rv${v}z.${toB64url(await pipeThrough(json, new CompressionStream('deflate-raw')))}`;
}
export function isShareFragment(fragment) {
 return /^#?rv\d+z?\./.test(fragment ?? '');
}
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
function settingsFile(S, state) {
 const v = state?.files ? SHARE_VERSION_PROJECT : SHARE_VERSION;
 const n = normalise(S, state, v);
 if (v === SHARE_VERSION_PROJECT) delete n.source;
 return `${JSON.stringify({ format: FILE_FORMAT, version: v, ...n }, null, 2)}\n`;
}
function readSettingsFile(S, text) {
 let obj;
 try { obj = JSON.parse(text); } catch { throw new ShareError('corrupt', 'not a JSON file'); }
 if (obj?.format !== FILE_FORMAT) throw new ShareError('format', 'not a MAVILERA settings file');
 if (!READS.includes(obj.version)) throw new ShareError('version', `settings file version ${obj.version}; this version reads ${READS.join(' and ')}`, { version: obj.version });
 return normalise(S, obj, obj.version);
}
export function createShare(S) {
 return {
 normalise: (s, version) => normalise(S, s, version),
 encodeFragment: (state, options) => encodeFragment(S, state, options),
 decodeFragment: (fragment) => decodeFragment(S, fragment),
 settingsFile: (state) => settingsFile(S, state),
 readSettingsFile: (text) => readSettingsFile(S, text),
 };
}

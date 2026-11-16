// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Wasi, MemFS } from './wasi.js';
export const PROJECT_DIR = '/project';
export const OBJ_DIR = '/build';
const ENV = { PWD: PROJECT_DIR, TMPDIR: '/tmp', HOME: '/tmp' };
export function packFS(files) {
 const fs = new MemFS();
 for (const [p, d] of files) fs.addFile(p, d);
 for (const d of [PROJECT_DIR, OBJ_DIR, '/tmp']) fs.mkdir(d);
 return fs;
}
export function expand(template, vars) {
 const out = [];
 for (const a of template) {
 if (a === '{objs}') out.push(...vars.objs);
 else if (/^\{\w+\}$/.test(a)) {
 const k = a.slice(1, -1);
 if (!(k in vars)) throw new Error(`template needs ${a}`);
 out.push(vars[k]);
 } else out.push(a);
 }
 return out;
}
export async function runJob(module, fs, argv) {
 const wasi = new Wasi({ args: argv, env: ENV, fs });
 const t0 = performance.now();
 let code;
 try {
 const inst = await WebAssembly.instantiate(module, wasi.imports());
 code = wasi.start(inst);
 } catch (e) {
 code = 134;
 wasi.stderr.push(new TextEncoder().encode(`${argv[0]}: stopped (${e && e.message})\n`));
 }
 return { code, stdout: wasi.text('stdout'), stderr: wasi.text('stderr'), ms: performance.now() - t0 };
}
export const PACK_SETS = Object.freeze(['uart', 'uart_mc', 'usb', 'usb_mc']);
export const DEFAULT_SET = 'uart';
export const STDIO_CHOICES = Object.freeze(['uart', 'usb']);
const MULTICORE_HEADER = 'pico/multicore.h';
const uncomment = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
export function includesHeader(text, header) {
 const h = header.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
 return new RegExp(`^[ \\t]*#[ \\t]*include[ \\t]*[<"]${h}[>"]`, 'm').test(uncomment(text));
}
export function chooseSet(meta, files, { stdio = 'uart' } = {}) {
 const io = STDIO_CHOICES.includes(stdio) ? stdio : 'uart';
 const multicore = files.some((f) => /\.(c|h|S)$/.test(f.name) && includesHeader(f.text, MULTICORE_HEADER));
 const id = `${io}${multicore ? '_mc' : ''}`;
 const have = meta.sets ? id in meta.sets : id === DEFAULT_SET;
 return { id: have ? id : null, stdio: io, multicore };
}
export function setOf(meta, set = DEFAULT_SET) {
 if (meta.sets) {
 const s = meta.sets[set];
 if (!s) throw new Error(`the SDK pack has no object set ${set}`);
 return s;
 }
 if (set !== DEFAULT_SET) throw new Error(`the SDK pack has no object set ${set}`);
 return { templates: meta.templates, pch: meta.pch };
}
export function includeNames(text) {
 const out = [], seen = new Set();
 for (const m of uncomment(text).matchAll(/^[ \t]*#[ \t]*include[ \t]*(?:"([^"\n]+)"|<([^>\n]+)>)/gm)) {
 const name = (m[1] ?? m[2]).trim(), quoted = m[1] !== undefined;
 if (!seen.has(name)) { seen.add(name); out.push({ name, quoted }); }
 }
 return out;
}
const SEARCH_GROUP = Object.freeze({ '-iquote': 'quote', '-I': 'user', '-isystem': 'system', '-internal-isystem': 'internal', '-internal-externc-isystem': 'internal' });
export function includeSearchDirs(args) {
 const d = { quote: [], user: [], system: [], internal: [] };
 for (let i = 0; i < args.length; i++) {
 const a = args[i];
 if (SEARCH_GROUP[a] && i + 1 < args.length) { d[SEARCH_GROUP[a]].push(args[++i]); continue; }
 const m = /^(-iquote|-isystem|-I)(.+)$/.exec(a);
 if (m) d[SEARCH_GROUP[m[1]]].push(m[2]);
 }
 return d;
}
export function resolveInclude(has, dirs, name, quoted) {
 if (name.startsWith('/') || name.split('/').includes('..')) return null;
 for (const dir of [...(quoted ? dirs.quote : []), ...dirs.user, ...dirs.system, ...dirs.internal]) {
 const p = `${dir.replace(/\/+$/, '')}/${name}`;
 if (has(p)) return p;
 }
 return null;
}
export async function preparePch(module, fs, meta, set = DEFAULT_SET) {
 const s = setOf(meta, set);
 if (!s.pch || !s.templates.pch) return { ok: false, code: -1, stdout: '', stderr: 'the pack has no precompiled header', ms: 0 };
 const r = await runJob(module, fs, s.templates.pch);
 return { ok: r.code === 0, ...r };
}
const stem = (name) => name.replace(/\.[^.]*$/, '');
const C_FILE = /\.c$/i, ASM_FILE = /\.(S|s|sx)$/;
export function startsWithPchHeader(text, header) {
 const src = text.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean);
 const first = src.find((l) => l.startsWith('#'));
 return Boolean(first && new RegExp(`^#\\s*include\\s*[<"]${header.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}[>"]$`).test(first));
}
export async function buildProject({ module, fs, meta, files, usePch = true, set = DEFAULT_SET }) {
 const s = setOf(meta, set);
 const t = s.templates;
 const enc = new TextEncoder();
 const jobs = [], objects = [];
 for (const f of files) fs.write(`${PROJECT_DIR}/${f.name}`, enc.encode(f.text));
 let failed = false;
 for (const f of files) {
 if (!C_FILE.test(f.name) && !ASM_FILE.test(f.name)) continue;
 const src = `${PROJECT_DIR}/${f.name}`, obj = `${OBJ_DIR}/${stem(f.name)}.${C_FILE.test(f.name) ? 'c' : 'S'}.o`;
 if (C_FILE.test(f.name)) {
 const pch = usePch && s.pch && fs.stat(s.pch.path) && startsWithPchHeader(f.text, s.pch.header);
 const argv = expand(pch ? t.cPch : t.c, { src, obj, name: f.name });
 const r = await runJob(module, fs, argv);
 jobs.push({ file: f.name, step: pch ? 'compile (precompiled header)' : 'compile', ...r });
 if (r.code !== 0) failed = true; else objects.push(obj);
 } else {
 const tmp = `/tmp/${stem(f.name)}.s`;
 const pre = await runJob(module, fs, expand(t.asmPreprocess, { src, tmp, name: f.name }));
 jobs.push({ file: f.name, step: 'preprocess', ...pre });
 if (pre.code !== 0) { failed = true; continue; }
 const as = await runJob(module, fs, expand(t.asm, { tmp, obj, name: f.name }));
 jobs.push({ file: f.name, step: 'assemble', ...as });
 if (as.code !== 0) failed = true; else objects.push(obj);
 }
 }
 if (failed || objects.length === 0) return { ok: false, objects, jobs, reason: failed ? 'compile' : 'nothing' };
 const out = `${OBJ_DIR}/program.elf`;
 const r = await runJob(module, fs, expand(t.link, { objs: objects, out }));
 jobs.push({ file: null, step: 'link', ...r });
 if (r.code !== 0) return { ok: false, objects, jobs, reason: 'link' };
 return { ok: true, elf: fs.read(out), objects, jobs };
}

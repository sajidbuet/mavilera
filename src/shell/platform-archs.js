// platform-archs.js -- the tools a user can switch between from the header logo (docs/architecture/arch-switcher.md),
// in the order of site/architectures.json: the available modules, then the NPU and GPU. Each entry shows its name
// lockup (the chip and the tool's name, without MAVILERA, 2026-11-04). A test pins the modules to that registry; add a
// line here when a module becomes available (docs/ADDING-SIMULATORS.md). Every build carries the logo files named
// here, so that its switcher can show them.
//   - A `module` entry is a tool inside another module: the NPU is a device of the RISC-V module (decision G2), opened
//     as `riscv/?tool=npu` on the module's NPU view (`view`); its page shows the `header` lockup.
//   - A `preview` entry is a planned module listed on the development page only, never in a release build or the
//     offline file (W-D35 addendum; ARMv7 was one until ARM-A6, 2026-11-02; the GPU is one until its release).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const PLATFORM_ARCHS = Object.freeze([
  // `views`: the module's views a tool shows, in the module's order (absent: all); the NPU tool's views are its own
  Object.freeze({ id: 'riscv', name: 'RISC-V', logo: 'mavilera-name-riscv.svg', views: Object.freeze(['isa', 'single', 'multi', 'pipe', 'compare']) }),
  Object.freeze({ id: 'sap-1', name: 'SAP-1', logo: 'mavilera-name-sap-1.svg' }),
  Object.freeze({ id: 'sap-2', name: 'SAP-2', logo: 'mavilera-name-sap-2.svg' }),
  Object.freeze({ id: 'armv7', name: 'Armv7', logo: 'mavilera-name-armv7.svg' }), // available from 1.1.0 (ARM-A6)
  Object.freeze({ id: 'i8086', name: '8086', logo: 'mavilera-name-8086.svg' }), // the 8086 beta (8086-B0 to B2; author, 2026-11-05)
  Object.freeze({ id: 'npu', name: 'NPU', logo: 'mavilera-name-npu.svg', header: 'mavilera-logo-npu.svg', module: 'riscv',
    view: 'npu', views: Object.freeze(['isa', 'npu-single', 'npu', 'npu-analysis']) }), // NPU-3: no multicycle or pipelined host (the book times the NPU on the ISS and the single-cycle processor only); NPU-4: the Analysis view
  Object.freeze({ id: 'gpu', name: 'GPU', logo: 'mavilera-name-gpu.svg' }), // published as a preview module from 1.2.0 (GPU-1; author, 2026-11-04)
]);

/** Where the name lockup stands in a header lockup, as a multiple of the lockup's height: the name files begin 12
 *  units before the chip, which stands at 1637.8 of the 192-unit high header files (tools/logo/make_logo.py). */
export const NAME_AT = 1625.8 / 192;

/** Where the landing page is: the folder above a release page; the site's address from a local file and from the
 *  development tree, which has no landing page of its own (author, 2026-11-04). `where` is {protocol, href, release}. */
export function homeUrl({ protocol, href, release }) {
  if (protocol === 'file:' || !release) return 'https://sajidlab.org/mavilera/';
  return new URL('../', href).href;
}

/** The link to another architecture's page, by the same three rules (the development page selects with `?arch=`). */
export function archUrl(id, { protocol, href, release }) {
  if (protocol === 'file:') return `https://sajidlab.org/mavilera/${id}/`;
  return release ? new URL(`../${id}/`, href).href : `?arch=${id}`;
}

/** The link to a tool: its module's page, with `tool=<id>` for a tool inside a module. */
export function toolUrl(tool, where) {
  if (!tool.module) return archUrl(tool.id, where);
  const base = archUrl(tool.module, where);
  return `${base}${base.includes('?') ? '&' : '?'}tool=${tool.id}`;
}

/** The views of `arch` a tool shows (its `views` list; all when it has none), in the descriptor's order. */
export function toolViews(arch, tool) {
  const list = tool?.views;
  const shown = list ? arch.views.filter((v) => list.includes(v.id)) : arch.views;
  return shown.length ? shown : arch.views;
}

/**
 * Tools inside a module that have no entry of their own in the switcher (author, 2026-11-05): they are reached from
 * another tool (`within`), whose entry the switcher shows as current on their pages. The CPU + GPU system (GPU-7,
 * decision G30): the RISC-V module's single-cycle processor with the GPU module's SIMT core on its bus at
 * 0x5000_1000, opened from the GPU Laboratory; `platform` is the platform setting its pages start with, `profile` the
 * instruction-level profile (RV32IM with the devices).
 */
export const HOSTED_TOOLS = Object.freeze([
  Object.freeze({ id: 'cpu-gpu', name: 'CPU + GPU', logo: 'mavilera-name-gpu.svg', header: 'mavilera-logo-gpu.svg', module: 'riscv', within: 'gpu',
    view: 'gpu-host', views: Object.freeze(['isa', 'gpu-single', 'gpu-host']), profile: 'ch11', platform: Object.freeze({ gpu: true }),
    template: 'cpu-gpu-abs' }), // opened on the first visit; the tool keeps its own program (author, 2026-11-05)
]);

/** The tool a page shows: the one its `tool=` parameter names, if that tool lives in this module; else the module. */
export function currentTool(archId, search, list = PLATFORM_ARCHS) {
  const asked = new URLSearchParams(search).get('tool');
  const all = list === PLATFORM_ARCHS ? [...list, ...HOSTED_TOOLS] : list;
  return all.find((t) => t.id === asked && t.module === archId) ?? all.find((t) => t.id === archId) ?? null;
}

/** The other tools, as {id, name, logo, url}, in list order; a preview module on the development page only. */
export function switchTargets(currentId, where, list = PLATFORM_ARCHS) {
  const dev = where.protocol !== 'file:' && !where.release;
  return list.filter((a) => a.id !== currentId && (!a.preview || dev))
    .map((a) => ({ id: a.id, name: a.name, logo: a.logo, url: toolUrl(a, where) }));
}

# Adding a simulator to MAVILERA

Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.

Each simulator is a module of its own at its own address (`/mavilera/<id>/`), built on the **architecture
contract** (spec W-D29): the module supplies a descriptor (its assembler, execution engine, registers, address
space, views, exports, content and interface strings) and the shared shell supplies everything else (editor,
listing, registers and memory panels, console, run control, share links, settings, exports, help, pan and zoom of
the drawings). The release builds one application per architecture, containing that architecture's modules and
content and no other's. The contract is `src/arch/contract.js` (`CONTRACT_VERSION`; each field is documented there).
SAP-1 (`src/arch/sap-1/`) is the smallest complete example.

Do not share an execution engine between architectures, and do not change the RISC-V decoder or any RISC-V module
for another processor. A shell change that only one architecture needs is a contract change instead (below).

## Steps

1. **Descriptor.** Create `src/arch/<id>/index.js` exporting `descriptor` (the `Descriptor` type of
   `src/arch/contract.js`, `contract: CONTRACT_VERSION`), with its modules beside it: language (assembler,
   disassembler, fields), engine (step, back-step, state), `strings.js` (British English, WS-N-007; at least
   `appFull`, "<Architecture> Laboratory", which names the page and the build), and view modules under `ui/`,
   loaded on demand by `views[].load`. Each capability of `CAPABILITIES` is `true` or
   `{ enabled: false, reason }`; the shell shows a disabled item with its reason. The header and the toolbar are
   the shell's, the same for every architecture: the profiles fill the toolbar's Architecture selector and the
   views the header's view tabs, and what does not fit moves into the rows' More menus (`src/ui/overflow.js`). Only relative imports
   (`import { a } from './x.js'`, `import('./x.js')`): the offline build reads no other form.
2. **Registry.** Add one line to `src/arch/registry.js`, `'<id>': () => import('./<id>/index.js'),`. The
   development page then runs it as `/?arch=<id>`; storage keys are scoped to it (`pips.<id>.*`).
3. **Content.** Put templates, examples and other files under `content/<id>/` and name them in the descriptor's
   `content` (`templates`, `examples`, `help`, `exercises`, `docs`, `logo`; each optional). A header lockup is a
   branding asset, made with `tools/logo/` and approved by the author.
4. **Tests.** The conformance suite (`test/arch-contract.test.mjs`) runs every registry entry without changes.
   Add the module's own tests (`test/<id>-*.test.mjs`: assembler, engine, view models, templates), then run
   `npm test`, `node tools/browser-smoke.mjs` (RISC-V unchanged) and `node tools/module-smoke.mjs --arch <id>`
   (the contract-level smoke tests and the axe-core scan on the development page).
5. **Build and landing page.** In `site/architectures.json` give the entry `content` (its content folders, from
   which `tools/site-files.mjs archFiles` selects the files), a `description` (claim only what has been verified),
   `docs` if `content.docs` names documentation (`<path>docs/`), and `status: "available"`. `tools/release.mjs`
   then builds it into `dist/<path>`: page and manifest named after `appFull`, its own service worker and cache, a
   single-file offline build `mavilera-<id>-<version>.html`, and only the modules reached from the page with a
   one-entry registry. It refuses a registry that says `available` for a module it did not build, or `planned`
   for one whose build is present, and a module over 1.25 MB without examples (WS-N-004, W-D31), counted as published: the
   JavaScript, CSS and JSON without comments and indentation (`tools/minify.mjs`), and of the logo files only
   those the page, the manifest or a module names. Write code that the minifier keeps working: no statement that
   relies on its indentation, and nothing the offline bundler reads (`export`, `import`) in a comment.
6. **Pinned lists.** `test/platform.test.mjs` pins the list of available modules: update it deliberately. Add the
   module to `src/shell/platform-archs.js` (id, name, header lockup) so that the header logo's architecture switcher
   lists it, in the order of `site/architectures.json`; `test/arch-switcher.test.mjs` checks the two agree. Never list
   a planned module.
7. **Verification.** The maintainer's verification run (private, as in `docs/DEPLOYMENT.md`) runs every test,
   RISC-V's smoke tests and `tools/module-smoke.mjs` on each available module's release build (service worker and
   offline file included) and writes `web-sim-validation.json`; the release requires a passing record.
8. Document what the module does not model, in its help. Claim only what has been verified.

## When the contract does not fit

Change the contract, not the shell for one architecture: propose the field, have the author approve it, raise
`CONTRACT_VERSION`, update every descriptor and the conformance suite. Optional fields keep the older descriptors
valid in meaning.

## Reserved paths

`riscv`, `sap-1`, `sap-2`, `6502`, `8086`, `armv7`, `mips`. Planned modules have no page, no link and no
route until built.

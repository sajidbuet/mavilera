# tools/ — development tools (rights class: code)

Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
Rights class: code.

Development only; nothing here ships with the site. Python tools run as
`python -I tools/<script>`; they read the book repository (default
`../book-MES`) read-only.

| Tool | Purpose | Used by |
|---|---|---|
| `serve.mjs` | Static development server (`npm run dev`); `startServer()` for the smoke tests | `browser-smoke.mjs` |
| `browser.mjs` | Driver of a locally installed Chrome or Edge over the DevTools protocol, with Node's own WebSocket (no npm package; spec W-D18) | `browser-smoke.mjs` |
| `browser-smoke.mjs` | WS-V-031: smoke tests in each installed browser (load at 1366 × 768, assemble/step/back-step, share-link round trip, trace and golden-dump downloads identical to `risc-vista-run.mjs`, visible focus at every tab stop, the Help dialog) and an axe-core scan of every view, both themes, projector mode (`npm run smoke`; `--out report.json`). With `--root dist --path app/` it tests a release build, adding the release edition (no JALR switch), the service worker (reload with the network off) and the landing and documentation pages; `--offline file.html` adds the single-file build opened from the disk. The DOM snapshot check compares every view's panes and controls with `test/fixtures/dom-snapshot.json` (`--update-snapshot` rewrites it) | by hand; `verify.mjs --smoke` |
| `header-smoke.mjs` | The header and the toolbar (`docs/ui/header-toolbar.md`) at 320 to 1920 px for each architecture: one line per row, no overlap or sideways scrolling, every command reached in its row or More menu and used from there, shortcuts, Escape, resize (`npm run smoke:header`; `--shots dir`) | by hand |
| `dock-smoke.mjs` | The execution controls docked on top, left and right (`docs/ui/header-toolbar.md`) in Armv7, RISC-V and SAP-1 at 1280 × 720 to 1920 × 1080: Top by default, each column laid out without overlap, the row's height given to the workspace, the choice kept over a reload and across architectures, the row on a narrow screen with the choice kept, every command used from the column (menus beside it, in the window, Escape), state, drawing and zoom unchanged by a change of place, Fit to height kept through it, the Dock menu by keys (`npm run smoke:dock`; `--shots dir`) | by hand |
| `view-mode-smoke.mjs` | The workspace view modes (`docs/ui/header-toolbar.md`): Normal, Datapath focus and Full screen in every view of Armv7, RISC-V and SAP-1; the drawing's area per mode at 1920 × 1080 to 390 × 844; state, breakpoints and the drawing kept; sizes, folds, Maximise and Enlarge restored, changes made in focus kept; the dock in focus; full screen refused, left by the browser, rapid changes; F and Esc; the narrow screen; axe-core (`npm run smoke:view`; `--shots dir`). Headless full screen does not change the window size | by hand |
| `mobile-smoke.mjs` | The workspaces of a narrow screen (`docs/ui/mobile-workspaces.md`) in RISC-V and SAP-2: tabs and panes per workspace at 320 to 768 px, the editor, breakpoints, watchpoints and a run across workspace changes, the console sheet and badge, the datapath workspace by touch, a turn of the screen, narrow to wide, the desktop layout untouched, axe-core, the help window's × (`npm run smoke:mobile`; `--shots dir`) | by hand |
| `npu-smoke.mjs` | The NPU tab (NPU-3): npu-mv stepped into the NPU's run, the four levels drawn, the array explorer's four steps, axe-core light, dark and projector, nothing moving with reduced motion, each level's i button and zoom toolbar beside the level buttons, no sideways scrolling at 360 px, the subsystem regions and mini-map at 360 px, the NPU signals in the single-cycle view's waveform with the devices on (`--shots dir`) | by hand |
| `analysis-smoke.mjs` | The NPU tool's Analysis view (NPU-4): npu-mv assembled; Offload gives the per-vector breakdown 9 + 12 + 8 + 5 = 34, Compare the laboratory's cycles, Roofline two plots with the run's point, Amdahl WE 11.1; every tab axe-clean light, dark and projector, no book or chapter named in a tab or i pop-up; the tabs by arrow keys; no sideways scrolling at 360 px (`--shots dir`) | by hand |
| `npu/ch11-tables.mjs` | Writes `content/data/ch11-tables.json` from the book's Chapter 11 at a git ref (Table 11.3, FIG-0115 kernels, FIG-0106 fractions, Table 11.5 checked against FIG-0116) and the laboratory data sets from `test/fixtures/npu/ch11/data` (`--book`, `--ref`; `--check`) | `test/npu-curriculum.test.mjs` |
| `armv7/make-single-geometry.mjs` | Writes `content/armv7/geometry/single.json`, the ARM single-cycle drawing (roadmap ARM-A2; original layout, author-approved 2026-10-31) | by hand, after a layout change |
| `armv7/preview-single.html`, `armv7/preview-single.mjs` | The ARM single-cycle drawing outside the application, one instruction class per case; the script screenshots every case, light and dark (`node tools/armv7/preview-single.mjs <dir>`) | by hand, for drawing reviews |
| `armv7/check-geometry.mjs` | Prints the schematic checks (junctions, widths, unplaced markers, collisions) of both ARM single-cycle drawings | by hand, with `make-single-geometry.mjs` |
| `armv7/single-smoke.mjs` | The ARM single-cycle view in each installed browser: Fig 7.60 run to its end against the Node.js model, step and step back, the Cycle and Control tabs, a class path, a failed condition, an instruction outside the base design (`--shots dir`) | by hand |
| `arch-coupling.mjs` | Architecture contract (W-D29): counts the RISC-V references in `main.js`, `src/ui/` and `strings.js` (`--lines`, `--json`) | by hand; `docs/architecture/arch-contract.md` |
| `ref_trace.py` | Reference assembler, disassembler and ISA traces from `code/sim` (WS-V-010–013) | conformance, random tests |
| `export_ch06.py` | Chapter 6 drawing, decoder tables and delay table → `content/` (WS-F-070) | by hand; `--check` |
| `rtl_trace_ch06.py` | Per-cycle signals of the Chapter 6 reference RTL under Icarus (WS-V-021) | `test/rtl.test.mjs` |
| `export_ch07.py` | Chapter 7 drawing (FIG-0067–0069, per-state paths and tags), state diagram FIG-0072 with the Guided Self-study states, state-output table, transitions, cycles, delays → `content/`; the JALR state (an exercise answer) apart in `content/data/ch07-jalr.json`, which releases leave out (W-D20) | by hand; `--check` in `test/release.test.mjs` |
| `rtl_trace_ch07.py` | Per-cycle signals of the Chapter 7 reference RTL, controller included (WS-V-021) | `test/rtl-multi.test.mjs` |
| `export_ch08.py` | Chapter 8 drawing: FIG-0015 + FIG-0017 forwarding, prediction variant → `content/geometry/ch08.json`; stage delays and T_c (tab:pipe-stage-delays, wex:pipe-tc) → `content/data/ch08-timing.json` | by hand; `--check` |
| `export_ch11.py` | Chapter 11 NPU drawings: FIG-0114 and the FIG-0113 step panel (N = 2, 3, 4) from the book's generator `code/chapter11/make_fig_npu.py` (book branch `fig/ch11-npu-generators`), a model signal per wire → `content/geometry/ch11-npu.json` | by hand; `--book <dir>`; `--check` |
| `make-exercises.mjs` | The practice exercises of `content/exercises/` (W-D24): tasks, starters, and tests whose expected values a JavaScript model computes; `--check`. Model solutions are test fixtures only | `test/practice-exercises.test.mjs` |
| `make-logo.mjs` | The three logo SVGs from the TikZ master `content/branding/source/risc-vista-logo.tex` (pdflatex, pdftocairo; letters outlined, colours as theme variables); `--check` | by hand |
| `make-icons.mjs` | PNG icons and `favicon.ico` from `content/branding/risc-vista-icon.svg`, rendered by a local Chrome or Edge (headless); `--check` | by hand; `test/branding.test.mjs` checks the files |
| `risc-vista-run.mjs` | Headless runner (WS-F-127): a program on a profile or datapath model; JSON report, trace (JSON lines, CSV), golden dump, VCD, comparison | by hand |
| `ref_cc.py` | WS-V-030: C programs built by the pinned GCC (`riscv32-pico-elf-gcc`, flags of `verify_sim.py` T2) and the compiler's assembly, run in `rvsim.py` with `--abi-check` | `test/cc.test.mjs` |
| `rtl_trace_ch08.py` | Per-cycle signals of the Chapter 8 RTL with each laboratory-stage hazard unit and predictor (WS-V-021/022) | `test/rtl-pipe.test.mjs` |
| `rtl_trace_ch11.py` | Per-cycle signals of the Chapter 11 system-on-chip with the reference NPU: the NPU's controller, registers and PEs, and the data bus (NPU-5, validation level L4); any program and data set | `test/rtl-npu.test.mjs` |
| `export_examples.py` | Example library (WS-F-123) → `content/examples/`: worked examples, reference programs and simulator tests only; prints what it took and skipped (C5) | by hand; `--check` in `test/examples.test.mjs` |
| `ref_cycles_ch08.py` | Cycle counts of `pipe_model.py`; 1-bit predictor; cycle model of early branch resolution (WS-F-057) | `test/pipe.test.mjs` |
| `verify.mjs` | WS-V-040: runs every test suite and, with `--smoke`, the smoke tests on a preview release build; writes `web-sim-validation.json` with the SHA-256 of the shipped sources, the tests, the tools and the book's reference files (instructor files as one hash per group), and every check's result. Passes only with no failure and no skipped check | before a release |
| `release.mjs` | Published site in `dist/` (W-D19 to W-D21): landing page at the root (`sajidlab.org/riscvista/`), `docs/`, the application in `app/` with its files under `app/assets/<hash>/` (WS-N-010), service worker (WS-N-012), `_headers`, the single-file offline build (WS-N-002); release edition without the JALR answer. Refuses unless the validation record passes and its hashes match (WS-V-041); `--preview` reports the gates only | `npm run release`; `npm run preview` (serves `dist/` on port 8001) |
| `offline.mjs` | The single-file build: rewrites the ES modules into one script, inlines the style sheet and content files, answers `fetch()` and the run Worker from the page | `release.mjs`; `test/release.test.mjs` |
| `site-files.mjs` | The shipped and the released file lists; hashing | `verify.mjs`, `release.mjs` |
| `screenshots.mjs` | Retakes `docs/screenshots/*.jpg` from the current interface in a headless Chrome or Edge | by hand |

## To move to the book repository (spec §16)

The export and RTL scripts are here by interim author decision
(2026-10-26); spec §15.2 and §16 place them in the book repository. When
they move, each keeps its `--check`, and the tests here call them from
there:

- `export_examples.py`;
- `export_ch06.py`, `export_ch07.py`, `export_ch08.py` (the figure
  generators may then read the same JSON, WS-F-071);
- `rtl_trace_ch06.py`, `rtl_trace_ch07.py`, `rtl_trace_ch08.py`, `rtl_trace_ch11.py` (they read instructor RTL, which
  must not be copied here, spec C5);
- `ref_cycles_ch08.py`: the early-resolution cycle model would become the
  extension of `pipe_model.py` that WS-F-057 asks for.

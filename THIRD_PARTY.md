# Third-party components

Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.

The shipped site contains no third-party code (spec §5.4). The components
below are development dependencies only: they are installed by `npm install`
into `node_modules/`, used by the tests and tools, and never copied into the
site or the offline build. Each needs the author's approval before it is added.

| Component | Version | Licence | Used by | Purpose | Approved |
|---|---|---|---|---|---|
| [axe-core](https://github.com/dequelabs/axe-core) | 4.14.0 (exact) | MPL-2.0 | `tools/browser-smoke.mjs` | Accessibility scan of the interface in a headless browser (WS-V-031, WS-U-034) | Author, 2026-10-27 (spec W-D18) |

Browsers used by the smoke tests (`tools/browser.mjs`) are the ones installed
on the developer's machine; they are driven over their own remote protocol and
are not dependencies of the repository.

## Data

| Component | Version | Licence | Used in | How | Approved |
|---|---|---|---|---|---|
| RP2350 CMSIS-SVD register description (`src/rp2350/hardware_regs/RP2350.svd` of [pico-sdk](https://github.com/raspberrypi/pico-sdk)), Copyright (c) 2024 Raspberry Pi Ltd. | pico-sdk 2.3.1 (`079c6f3`) | BSD-3-Clause | `src/arch/pico2/soc/regs.generated.js` | Block base addresses, and register offsets, reset values and field-access masks of the blocks the pico2 module models, written by `tools/gen-pico2-regs.mjs` | Author, 2026-11-06 (research decision D13, Q1) |

The BSD-3-Clause licence of the SVD data: Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met: (1) Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer. (2) Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the
distribution. (3) Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote
products derived from this software without specific prior written permission. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS
AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Pico Full download (pico2 P1-F2)

The Pico 2 module's Pico SDK C (research ADR-0012, decisions D28 and D33) uses a compiler and SDK files that are **not part of
the site's files**: an optional download, fetched only when a student builds with Pico SDK C and agrees to the notice, and
kept in that browser. They are made by `tools/pico-full/` from the pinned sources below and published, with these licence
texts (`pico-full/<version>/licences/`), next to the site. Nothing of them is in this repository. The licence summary is in
the research repository (`research/licensing/pico-full-compiler-licences.md`); **publishing them waits for the licence
review recorded there** (picolibc's "Other-N" notices; D9).

| Component | Version | Licence | In | How | Approved |
|---|---|---|---|---|---|
| [LLVM](https://github.com/llvm/llvm-project) clang and lld, with an own WASI patch (`tools/pico-full/llvm-23.1.5-wasi.patch`, ported from YoWASP's) | 23.1.5 (`392dfff`) | Apache-2.0 WITH LLVM-exception (with BSD-2/BSD-3/ISC/CC0 parts in LLVM Support) | the compiler (`llvm-*.wasm`) | built to WebAssembly (RISC-V target only), run in a Worker | Author, 2026-11-07/08 (D27, D28) |
| [wasi-sdk](https://github.com/WebAssembly/wasi-sdk): wasi-libc, libc++, libc++abi, compiler-rt (wasm32) | 34 | Apache-2.0 WITH LLVM-exception / Apache-2.0 / MIT; musl MIT, cloudlibc BSD-2, musl-fts BSD-3, dlmalloc CC0 | the compiler | linked into it statically | Author, 2026-11-07 (D27) |
| [picolibc](https://github.com/picolibc/picolibc) | 1.8.12 (`2ae376c`) | BSD-3-Clause and other permissive notices (`COPYING.picolibc`) | the SDK pack | the C library of built programs | Author, 2026-11-07 (D27) |
| compiler-rt builtins (RV32) and clang's C headers | 23.1.5 | Apache-2.0 WITH LLVM-exception | the SDK pack | runtime and headers of built programs | Author, 2026-11-07 (D27) |
| [Raspberry Pi Pico SDK](https://github.com/raspberrypi/pico-sdk), with pico_printf (Marco Paland, MIT) | 2.3.1 (`079c6f3`) | BSD-3-Clause; pico_printf MIT | the SDK pack | headers, prebuilt objects, linker scripts | Author, 2026-11-09 (D33) |

## Artwork

| Component | Version | Licence | Used in | How | Approved |
|---|---|---|---|---|---|
| [Oswald](https://ctan.org/pkg/oswald) (Copyright 2016 The Oswald Project Authors) | 4.100, `oswald` package of 2021-10-17 in MiKTeX | SIL Open Font License 1.1 | `content/branding/*.svg` (from `content/branding/source/risc-vista-logo.tex`) | Outlines of its glyphs in the logo, made by `tools/make-logo.mjs`; no font file is shipped or loaded | Author, 2026-10-27 (logo design A) |
| [Montserrat](https://github.com/JulietaUla/Montserrat) (Copyright 2024 The Montserrat.Git Project Authors) | 9.000, Medium | SIL Open Font License 1.1 | `logo/mavilera-full.svg` | Outlines of its glyphs in the subtitle; no font file is shipped or loaded | Author, 2026-10-28 (OFL font for the logo labels) |
| [Inter](https://github.com/rsms/inter) (Copyright 2020 The Inter Project Authors) | 4.001, instance wght 700, opsz 14 | SIL Open Font License 1.1 | `logo/mavilera-full.svg` | Outlines of its glyphs in the instruction and pipeline labels; no font file is shipped or loaded | Author, 2026-10-28 (OFL font for the logo labels) |
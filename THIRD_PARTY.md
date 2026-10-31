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

## Artwork

| Component | Version | Licence | Used in | How | Approved |
|---|---|---|---|---|---|
| [Oswald](https://ctan.org/pkg/oswald) (Copyright 2016 The Oswald Project Authors) | 4.100, `oswald` package of 2021-10-17 in MiKTeX | SIL Open Font License 1.1 | `content/branding/*.svg` (from `content/branding/source/risc-vista-logo.tex`) | Outlines of its glyphs in the logo, made by `tools/make-logo.mjs`; no font file is shipped or loaded | Author, 2026-10-27 (logo design A) |
| [Montserrat](https://github.com/JulietaUla/Montserrat) (Copyright 2024 The Montserrat.Git Project Authors) | 9.000, Medium | SIL Open Font License 1.1 | `logo/mavilera-full.svg` | Outlines of its glyphs in the subtitle; no font file is shipped or loaded | Author, 2026-10-28 (OFL font for the logo labels) |
| [Inter](https://github.com/rsms/inter) (Copyright 2020 The Inter Project Authors) | 4.001, instance wght 700, opsz 14 | SIL Open Font License 1.1 | `logo/mavilera-full.svg` | Outlines of its glyphs in the instruction and pipeline labels; no font file is shipped or loaded | Author, 2026-10-28 (OFL font for the logo labels) |
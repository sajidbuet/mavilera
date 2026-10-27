# content/ — book-derived material and identity artwork (Apache-2.0)

Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
Rights class: content. Licensed under Apache-2.0 like the code since W-D25 (the name and logo
are not licensed as trademarks, see `TRADEMARKS.md`); `pip/` is excluded.

| Folder | Contents | Source in the book repository |
|---|---|---|
| `geometry/` | Processor drawings as data (WS-F-070) | `code/chapter06/`, `code/chapter07/` figure generators; FIG-0072 with the Guided Self-study states added (`ch07.json`, for review); FIG-0015 with the forwarding of FIG-0017 (`ch08.json`, for review) |
| `examples/` | Student-facing example programs, copied unchanged, and `index.json` (titles, tags, what was skipped and why) (WS-F-123) | `code/chapter0{3,4,6,7,8}/`, `code/sim/tests/asm/`, by `tools/export_examples.py` (W-D10); list for the author's C5 review |
| `help/` | The in-app help (`help.json`), the site documentation (`docs/`, published at `/riscvista/docs/`; spec W-D20) and the cycle-narrative templates (WS-F-033); the instruction hover help of WS-U-021 is interface text in `src/ui/strings.js` (`semantics`, `pseudoSemantics`) | Written afresh for the simulator |
| `data/` | Delay table and other values taken from the chapters (WS-F-034) | `chapters/chapter06/`, `chapters/chapter07/` tables, by script (the JALR state from the solution of exercise PRB-0129 is apart in `ch07-jalr.json`, shown only on request in the development tree and left out of releases: author decisions 2026-10-26 and W-D20) |
| `pip/` | Pip, the book's mascot (see `pip/README.md`); not part of the application's identity since 2026-10-27 | `resources/mascot/pip/`, approved assets only |
| `branding/` | The RISC-VISTA logo: full, compact, icon (`docs/branding/README.md`) | Drawn for this application (2026-10-27); not from the book |

Rules: nothing here is copied from instructor material (spec C5); every file
carries the copyright line and its rights class (JSON files: a top-level
`"_copyright"` field); the export scripts that create these files live in the
book repository and record what they took.

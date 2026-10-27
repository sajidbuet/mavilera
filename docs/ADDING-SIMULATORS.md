# Adding a simulator to MAVILERA

Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.

Each simulator is an independent application at its own address (`/mavilera/<id>/`): its own execution engine,
ISA implementation, state model, datapath views, examples, tests and build. Do not share an execution engine
between architectures, and do not change the RISC-V decoder for another processor. What may be shared is branding
(`content/branding/mavilera/`) and, when it is truly generic, small interface helpers.

## Steps

1. Build the simulator in its own folder or repository, producing a static directory whose `index.html` works
   at `/mavilera/<id>/` with relative paths only (no `/`-rooted URLs; the service worker, if any, derives its scope
   from its own location; use a storage-key prefix of its own, because all modules share one origin).
2. Use the MAVILERA logo, the colour tokens of `src/ui/theme.css`, and name it *MAVILERA — <Architecture> Laboratory*.
   Show a subtle "MAVILERA Home" link to `../` (as the RISC-V Laboratory does in a release).
3. Add it to the release: copy its built directory to `dist/<id>/` in `tools/release.mjs` (the RISC-V build is
   written to `dist/riscv/` by the same script; a separate module may have its own release script writing into
   the same `dist/`).
4. In `site/architectures.json` set the entry's `status` to `available`, add a `description` and, if it has one,
   `docs`. The landing page card and its launch button are generated from the registry; `tools/release.mjs`
   refuses a registry that says `available` for a module whose `index.html` is missing, or `planned` for one
   whose build is present.
5. Add tests for the module and for its entry (`test/platform.test.mjs` pins the list of available modules:
   update it deliberately).
6. Document anything the module does not model. Claim only what has been verified.

## Reserved paths

`riscv`, `sap-1`, `sap-2`, `6502`, `8086`, `armv7`, `mips`. Planned modules have no page, no link and no
route until built.
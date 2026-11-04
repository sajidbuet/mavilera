# Deployment: sajidlab.org/mavilera

Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.

## Target

| Address | Content |
|---|---|
| `https://sajidlab.org/mavilera/` | MAVILERA landing page |
| `https://sajidlab.org/mavilera/riscv/` | RISC-V Laboratory (works when opened directly, and after a refresh) |
| `https://sajidlab.org/mavilera/riscv/docs/` | its documentation |
| `https://sajidlab.org/mavilera/sap-1/` | SAP-1 Laboratory (no separate documentation) |
| `https://sajidlab.org/mavilera/sap-2/` | SAP-2 Laboratory (documentation at `sap-2/docs/`) |
| `https://sajidlab.org/mavilera/armv7/` | Armv7 Laboratory (from 1.1.0; documentation at `armv7/docs/`) |
| `https://sajidlab.org/mavilera/riscv/?tool=npu` | the NPU, a tool of the RISC-V Laboratory (from 1.2.0) |
| `https://sajidlab.org/mavilera/gpu/` | GPU Laboratory, a preview (from 1.2.0; no separate documentation) |

Every module whose status is `available` in `site/architectures.json` is built by `tools/release.mjs` into its
registry path, from `src/arch/<id>` and its content folders (W-D29; `docs/ADDING-SIMULATORS.md`).

## How it is hosted (checked 2026-10-27)

Observed from outside: `sajidlab.org` answers through Cloudflare (`server: cloudflare`) with GitHub's
`x-github-request-id` header, and `sajidbuet.github.io` redirects (301) to it; the repository
`sajidbuet/sajidbuet.github.io` has GitHub Pages enabled; `https://sajidlab.org/riscvista/` is a 404, so
nothing occupies a neighbouring path. **Not verified** (needs the repository settings): that
`sajidbuet.github.io` carries the custom domain `sajidlab.org`, and which generator builds it.

A GitHub Pages **project site** inherits the custom domain of its owner's user site, so a repository named
`mavilera` is served at `https://sajidlab.org/mavilera/` with no DNS change and no change to the user site's
source. Use that arrangement:

1. The repository `sajidbuet/mavilera` holds the source on `main` and the built site on the branch `gh-pages`
   (the content of `dist/`, produced by `npm run release`).
2. Settings, Pages: source = branch `gh-pages`, folder `/ (root)`. Leave "Custom domain" **empty** in this
   repository (the domain belongs to the user site; a `CNAME` file here would break it). Enable "Enforce HTTPS".
3. `dist/` contains `.nojekyll`, so files and folders starting with `_` are served.
4. Wait for the Pages build, then open the two addresses above. Existing pages of `sajidlab.org` are not touched.

No DNS record changes are needed or wanted: DNS resolves hostnames, not paths.

## Cloudflare (dashboard configuration, not code)

The domain is proxied by Cloudflare. Nothing is required for correctness. Optional, for speed:

- **Cache Rule**: if URI Path starts with `/mavilera/riscv/assets/` or `/mavilera/sap-1/assets/` or `/mavilera/sap-2/assets/` or `/mavilera/armv7/assets/` or `/mavilera/gpu/assets/` (one condition per
  module) then Eligible for cache, Edge TTL 1 year, Browser TTL 1 year. Safe because the folder name under `assets/`
  is a hash of the module's files: a new release gets a new folder.
- Leave everything else at the default. Each module's `sw.js` and `index.html` are re-validated by the service
  worker on each visit; GitHub Pages sets their cache lifetime (10 minutes), so after a release a visitor can see
  the previous page for up to that time, or longer if Cloudflare caches HTML ("Cache Everything" must not be used on `/mavilera/`).
- After a release you may purge `/mavilera/*` from the Cloudflare cache.
- Do not add a Worker, Pages Function or redirect rule for this site: the site is static (WS-N-008).

## Releasing

```powershell
# private maintainer step: node tools/verify.mjs --smoke  (all tests + browser smoke tests -> web-sim-validation.json)
npm run release                 # dist/ (refuses unless that record passes and matches the files)
```

Then publish `dist/` to `gh-pages` (replace the branch content; keep `.nojekyll`). The release script
reads `BASE_PATH` (default `/mavilera/`) and `SITE_ORIGIN` (default `https://sajidlab.org`) only for the
addresses printed on the landing page and in `og:` tags; every file reference is relative.

## Checks after publishing

- `/mavilera/`, `/mavilera/riscv/`, `/mavilera/riscv/?tool=npu`, `/mavilera/sap-1/`, `/mavilera/sap-2/`, `/mavilera/armv7/` and `/mavilera/gpu/` load; refresh on each
  works; each module's `docs/` loads.
- The browser console shows no 404 for `<module>/assets/<hash>/...`, and each module's service worker registers
  with its own scope (`/mavilera/riscv/`, `/mavilera/sap-1/`, `/mavilera/sap-2/`, `/mavilera/armv7/`, `/mavilera/gpu/`).
- `https://sajidlab.org/` and the other project pages are unchanged.
- The planned modules' paths (`/mavilera/6502/` ...) return 404 and are not linked from the landing page.

## Storage

The earlier RISC-VISTA build was never published, so no user data under another origin has to be migrated. The
browser-storage keys keep their historical names (`pips.*`), which are internal and not shown to users. All
simulators of MAVILERA share the origin `https://sajidlab.org`; the shell scopes every key but the theme and
projector settings by architecture (`pips.sap-1.*`, `pips.sap-2.*`; RISC-V keeps `pips.*`).
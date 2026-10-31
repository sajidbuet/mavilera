<!-- Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
     Rights class: code. -->
# tools/logo — the logo masters

Builds the fixed-colour SVG masters, PNG exports and `favicon.ico` in `logo/` from measured geometry of
`assets/mavilera-source.png`. Development only; nothing here ships. The web files in
`content/branding/mavilera/` are then written from `logo/` by `node tools/make-mavilera-brand.mjs`.

Requirements: Python 3 with `numpy`, `opencv-python`, `Pillow`, `fonttools`, `skia-pathops`, `resvg_py`; SVGO 3
(`npx svgo@3`); the fonts below in `tools/logo/fonts/` (or a folder named by `MAVILERA_FONTS`). The fonts are not
committed (SIL OFL 1.1, `THIRD_PARTY.md`): `Montserrat-Bold.ttf`, `Montserrat-SemiBold.ttf`, `Montserrat-Medium.ttf`
(Montserrat 9.000) and `Inter-700.ttf` (Inter 4.001, static instance wght 700, opsz 14).

```powershell
# 1. only when the source raster changes: colour labels and the fitted M (mark.json, committed)
python -I tools/logo/seg.py assets/mavilera-source.png $env:TEMP
python -I tools/logo/markfit.py $env:TEMP/labels.npy tools/logo/mark.json
# 2. the masters
python -I tools/logo/make_logo.py $env:TEMP/logo-raw
npx svgo@3 --config tools/logo/svgo.config.mjs -f $env:TEMP/logo-raw -o $env:TEMP/logo-min -q
python -I tools/logo/finish.py $env:TEMP/logo-raw $env:TEMP/logo-min logo
# 3. the web files
node tools/make-mavilera-brand.mjs
```

`finish.py` checks each SVG (view box, no `<image>`/`<text>`/fonts/strokes, copyright line, < 30 KB) and that SVGO
changed no rendered pixel. Step 1 rewrites `mark.json` without its `_copyright` field; add it back.

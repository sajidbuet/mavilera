# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: code. Development tool for the logo masters in logo/ (see tools/logo/README.md).
"""Verify optimised SVGs, copy to logo/, export PNGs and favicon."""
import sys, os, io, re, shutil, numpy as np, resvg_py
from PIL import Image
raw, mini, dest = sys.argv[1:4]
os.makedirs(dest, exist_ok=True)
def render(path=None, s=None, **kw):
    b = resvg_py.svg_to_bytes(svg_path=path, **kw) if path else resvg_py.svg_to_bytes(svg_string=s, **kw)
    return Image.open(io.BytesIO(bytes(b))).convert('RGBA')
for name in sorted(os.listdir(mini)):
    t = open(os.path.join(mini, name), encoding='utf-8').read()
    checks = {
        'viewBox': 'viewBox=' in t, 'no <image>': '<image' not in t, 'no <text>': '<text' not in t,
        'no font refs': not re.search(r'font-family|@font-face|<font', t), 'copyright': 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.' in t,
        'no gradient/stroke': not re.search(r'Gradient|stroke', t), 'size<30KB': len(t.encode()) < 30 * 1024,
    }
    a = np.asarray(render(os.path.join(raw, name), width=1200)).astype(int)
    b = np.asarray(render(os.path.join(mini, name), width=1200)).astype(int)
    diff = np.abs(a - b).max(-1); changed = (diff > 64).mean() * 100
    nodes = len(re.findall(r'[MLHVCSQTAZmlhvcsqtaz]', ''.join(re.findall(r' d="([^"]*)"', t))))
    bad = [k for k, v in checks.items() if not v]
    print(f'{name:28s} {len(t.encode()):6d} B  path cmds {nodes:5d}  svgo-vs-raw changed px {changed:.3f}%  ' + ('OK' if not bad else 'FAIL ' + ','.join(bad)))
    shutil.copy(os.path.join(mini, name), os.path.join(dest, name))
for base in ('mavilera-riscv', 'mavilera-mark'):
    for h in (512, 256, 128, 64):
        render(os.path.join(dest, base + '.svg'), height=h).save(os.path.join(dest, f'{base}-{h}.png'), optimize=True)
icon = render(os.path.join(dest, 'mavilera-icon.svg'), height=256)
icon.save(os.path.join(dest, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
ic = Image.open(os.path.join(dest, 'favicon.ico')); print('favicon sizes', sorted(ic.info.get('sizes', [])))

# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: code. Development tool for the logo masters in logo/ (see tools/logo/README.md).
import sys, numpy as np, cv2
from PIL import Image
src = sys.argv[1]; out = sys.argv[2]
a = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
NAVY = np.array([9, 44, 78.]); LIGHT = np.array([93, 157, 209.]); WHITE = np.array([254, 254, 254.])
d = np.stack([np.linalg.norm(a - c, axis=2) for c in (WHITE, NAVY, LIGHT)], 0)
lab = d.argmin(0).astype(np.uint8)
import os; np.save(os.path.join(out, 'labels.npy'), lab)
for k, name in ((1, 'navy'), (2, 'light')):
    m = (lab == k).astype(np.uint8)
    n, cc, st, cen = cv2.connectedComponentsWithStats(m, 8)
    print(name, 'components', n - 1)
    for i in np.argsort(st[1:, 0]) + 1:
        x, y, w, h, A = st[i]
        if A > 30: print(f'  #{i} x{x} y{y} w{w} h{h} A{A}')

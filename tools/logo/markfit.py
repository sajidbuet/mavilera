# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: code. Development tool for the logo masters in logo/ (see tools/logo/README.md).
"""Fit the M mountain/road shapes from the source raster and store the cleaned segments as JSON."""
import sys, json, numpy as np, cv2
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fitlib import contours, fit_contour, snap

lab = np.load(sys.argv[1]); out = sys.argv[2]
X0, Y0, X1, Y1 = 405, 125, 1175, 482
res = {}
for k, name in ((1, 'navy'), (2, 'light')):
    m = np.zeros(lab.shape, np.uint8); m[Y0:Y1, X0:X1] = (lab[Y0:Y1, X0:X1] == k)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    n, cc, st, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros_like(m)
    for i in range(1, n):
        x, y, w, h, A = st[i]
        if A < 60: continue
        trace_like = h < 60 and (x < 490 or x + w > 1100)
        if trace_like: continue
        keep[cc == i] = 1
    shapes = []
    for c in contours(keep, min_area=40):
        segs = snap(fit_contour(c))
        shapes.append([[s[0], [list(map(float, q)) for q in (s[1:] if s[0] == 'L' else s[1])]] for s in segs])
    res[name] = shapes
    print(name, len(shapes), 'contours,', sum(len(s) for s in shapes), 'segments')
json.dump(res, open(out, 'w'))

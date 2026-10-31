# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: code. Development tool for the logo masters in logo/ (see tools/logo/README.md).
"""Geometry helpers: pathops paths from polygons, arcs, filleted polylines with offsets, glyphs."""
import math, numpy as np, pathops
from fontTools.ttLib import TTFont
from fontTools.pens.transformPen import TransformPen

K = 0.5522847498

def new():
    return pathops.Path()

def poly(pts, path=None):
    p = path if path is not None else new(); pen = p.getPen()
    pen.moveTo(tuple(pts[0]))
    for q in pts[1:]: pen.lineTo(tuple(q))
    pen.closePath(); return p

def arc_cubics(c, r, a0, a1):
    """Cubic segments approximating a circular arc from angle a0 to a1 (radians, screen coords)."""
    n = max(1, math.ceil(abs(a1 - a0) / (math.pi / 2) - 1e-9)); out = []
    da = (a1 - a0) / n
    for i in range(n):
        s, e = a0 + i * da, a0 + (i + 1) * da
        h = 4 / 3 * math.tan((e - s) / 4)
        p0 = (c[0] + r * math.cos(s), c[1] + r * math.sin(s)); p3 = (c[0] + r * math.cos(e), c[1] + r * math.sin(e))
        p1 = (p0[0] - h * r * math.sin(s), p0[1] + h * r * math.cos(s))
        p2 = (p3[0] + h * r * math.sin(e), p3[1] - h * r * math.cos(e))
        out.append((p1, p2, p3))
    return out

class Builder:
    """Pen-like builder that understands lines and arcs and writes into a pathops path."""
    def __init__(self, path=None):
        self.path = path if path is not None else new(); self.pen = self.path.getPen(); self.cur = None
    def M(self, p): self.pen.moveTo(tuple(p)); self.cur = tuple(p); return self
    def L(self, p):
        p = tuple(p)
        if self.cur is None or math.dist(p, self.cur) > 1e-6: self.pen.lineTo(p)
        self.cur = p; return self
    def C(self, p1, p2, p3): self.pen.curveTo(tuple(p1), tuple(p2), tuple(p3)); self.cur = tuple(p3); return self
    def A(self, c, r, a0, a1):
        self.L((c[0] + r * math.cos(a0), c[1] + r * math.sin(a0)))
        for p1, p2, p3 in arc_cubics(c, r, a0, a1): self.C(p1, p2, p3)
        return self
    def Z(self): self.pen.closePath(); self.cur = None; return self

def rrect(x, y, w, h, r, path=None):
    b = Builder(path)
    b.M((x + r, y)).L((x + w - r, y)).A((x + w - r, y + r), r, -math.pi / 2, 0)
    b.L((x + w, y + h - r)).A((x + w - r, y + h - r), r, 0, math.pi / 2)
    b.L((x + r, y + h)).A((x + r, y + h - r), r, math.pi / 2, math.pi)
    b.L((x, y + r)).A((x + r, y + r), r, math.pi, 1.5 * math.pi).Z()
    return b.path

def rect(x, y, w, h, path=None):
    return poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], path)

def circle(c, r, path=None):
    b = Builder(path); b.M((c[0] + r, c[1])).A(c, r, 0, 2 * math.pi).Z(); return b.path

def pill(x0, x1, yc, h, left_round=True, right_round=True, path=None):
    r = h / 2; b = Builder(path)
    if left_round: b.M((x0 + r, yc - r))
    else: b.M((x0, yc - r))
    if right_round: b.L((x1 - r, yc - r)).A((x1 - r, yc), r, -math.pi / 2, math.pi / 2)
    else: b.L((x1, yc - r)).L((x1, yc + r))
    if left_round: b.L((x0 + r, yc + r)).A((x0 + r, yc), r, math.pi / 2, 1.5 * math.pi)
    else: b.L((x0, yc + r))
    return b.Z().path

def _u(v): n = math.hypot(*v); return (v[0] / n, v[1] / n)
def _perp(d): return (-d[1], d[0])

def trace(pts, radii, width, start=None, end=None, path=None):
    """Constant-width trace along a polyline with filleted corners (radius per interior vertex).
    start/end: None = butt; ('cut', p, d) = cut along the line through p with direction d; 'round' = round cap."""
    h = width / 2; n = len(pts)
    # pieces: list of ('L', a, b, d) and ('A', centre, r, sign, a0, a1)
    pieces = []; prev = pts[0]
    for i in range(1, n - 1):
        A, V, B = pts[i - 1], pts[i], pts[i + 1]
        d1 = _u((V[0] - A[0], V[1] - A[1])); d2 = _u((B[0] - V[0], B[1] - V[1]))
        cr = d1[0] * d2[1] - d1[1] * d2[0]; sg = 1 if cr > 0 else -1
        phi = math.acos(max(-1, min(1, d1[0] * d2[0] + d1[1] * d2[1])))
        r = radii[i - 1]; t = r * math.tan(phi / 2)
        T1 = (V[0] - d1[0] * t, V[1] - d1[1] * t); T2 = (V[0] + d2[0] * t, V[1] + d2[1] * t)
        pp = _perp(d1); C = (T1[0] + sg * pp[0] * r, T1[1] + sg * pp[1] * r)
        pieces.append(('L', prev, T1, d1))
        a0 = math.atan2(T1[1] - C[1], T1[0] - C[0]); a1 = a0 + sg * phi
        pieces.append(('A', C, r, sg, a0, a1)); prev = T2
    pieces.append(('L', prev, pts[-1], _u((pts[-1][0] - pts[-2][0], pts[-1][1] - pts[-2][1]))))

    def side(s):
        out = []
        for pc in pieces:
            if pc[0] == 'L':
                _, a, b, d = pc; pp = _perp(d)
                out.append(('L', (a[0] + pp[0] * s, a[1] + pp[1] * s), (b[0] + pp[0] * s, b[1] + pp[1] * s), d))
            else:
                _, C, r, sg, a0, a1 = pc; rr = r - sg * s
                out.append(('A', C, max(rr, 0.0), sg, a0, a1))
        return out

    def cutpt(p, d, q, e):
        # intersection of line p+t d and q+u e
        den = d[0] * e[1] - d[1] * e[0]
        t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
        return (p[0] + d[0] * t, p[1] + d[1] * t)

    L, R = side(h), side(-h)
    if start and start != 'round':
        for S in (L, R):
            _, a, b, d = S[0]; S[0] = ('L', cutpt(a, d, start[1], start[2]), b, d)
    if end and end != 'round':
        for S in (L, R):
            _, a, b, d = S[-1]; S[-1] = ('L', a, cutpt(a, d, end[1], end[2]), d)
    bld = Builder(path)
    def emit(S, rev):
        seq = S[::-1] if rev else S
        for pc in seq:
            if pc[0] == 'L':
                a, b = (pc[2], pc[1]) if rev else (pc[1], pc[2])
                if bld.cur is None: bld.M(a)
                bld.L(a); bld.L(b)
            else:
                _, C, r, sg, a0, a1 = pc
                if rev: a0, a1 = a1, a0
                if r < 1e-6: bld.L(C)
                else: bld.A(C, r, a0, a1)
    emit(L, False)
    if end == 'round':
        d = pieces[-1][3]; ang = math.atan2(_perp(d)[1], _perp(d)[0])
        bld.A(pts[-1], h, ang, ang - math.pi)
    emit(R, True)
    if start == 'round':
        d = pieces[0][3]; ang = math.atan2(-_perp(d)[1], -_perp(d)[0])
        bld.A(pts[0], h, ang, ang - math.pi)
    bld.Z()
    return bld.path

def union(paths):
    out = new()
    for p in paths:
        out = pathops.op(out, p, pathops.PathOp.UNION)
    return out

def diff(a, b):
    return pathops.op(a, b, pathops.PathOp.DIFFERENCE)

def merge(paths):
    """Concatenate paths without boolean ops."""
    out = new(); pen = out.getPen()
    for p in paths: p.draw(pen)
    return out

class Font:
    def __init__(self, file):
        self.f = TTFont(file); self.gs = self.f.getGlyphSet(); self.cmap = self.f.getBestCmap()
        self.upm = self.f['head'].unitsPerEm; self.cap = self.f['OS/2'].sCapHeight
    def glyph(self, ch): return self.cmap[ord(ch)]
    def adv(self, ch): return self.f['hmtx'][self.glyph(ch)][0]
    def ink(self, ch):
        from fontTools.pens.boundsPen import BoundsPen
        bp = BoundsPen(self.gs); self.gs[self.glyph(ch)].draw(bp); return bp.bounds
    def text(self, s, x, baseline, cap_px, tracking=0.0, align='left'):
        """Outline text; x is the left ink edge of the first glyph. Returns (path, ink_right)."""
        sc = cap_px / self.cap
        widths = [self.adv(c) * sc for c in s]
        lsb0 = (self.ink(s[0]) or (0, 0, 0, 0))[0] * sc
        p = new(); pen = p.getPen(); cx = x - lsb0
        last_right = x
        for i, ch in enumerate(s):
            if ch != ' ':
                tp = TransformPen(pen, (sc, 0, 0, -sc, cx, baseline))
                self.gs[self.glyph(ch)].draw(tp)
                b = self.ink(ch)
                if b: last_right = cx + b[2] * sc
            cx += widths[i] + tracking
        return pathops.op(p, new(), pathops.PathOp.UNION), last_right
    def measure(self, s, cap_px, tracking=0.0):
        sc = cap_px / self.cap
        _, r = self.text(s, 0, 0, cap_px, tracking)
        return r

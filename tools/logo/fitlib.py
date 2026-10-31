# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: code. Development tool for the logo masters in logo/ (see tools/logo/README.md).
"""Corner-aware contour fitting: straight lines where straight, few cubic Beziers elsewhere."""
import numpy as np, cv2

def contours(mask, scale=4, sigma=2.0, min_area=40):
    big = cv2.resize(mask.astype(np.float32), None, fx=scale, fy=scale, interpolation=cv2.INTER_LINEAR)
    big = cv2.GaussianBlur(big, (0, 0), sigma)
    b = (big > 0.5).astype(np.uint8)
    cs, hier = cv2.findContours(b, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cs:
        if cv2.contourArea(c) < min_area * scale * scale: continue
        p = c[:, 0, :].astype(float) / scale + (0.5 / scale - 0.5)
        out.append(p)
    return out

def resample(p, step=0.5):
    q = np.vstack([p, p[:1]])
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(q, axis=0), axis=1))]
    n = max(int(d[-1] / step), 8)
    s = np.linspace(0, d[-1], n, endpoint=False)
    return np.c_[np.interp(s, d, q[:, 0]), np.interp(s, d, q[:, 1])]

def smooth_closed(p, sig=1.0):
    n = len(p); k = int(3 * sig) + 1
    w = np.exp(-0.5 * (np.arange(-k, k + 1) / sig) ** 2); w /= w.sum()
    ext = np.vstack([p[-k:], p, p[:k]])
    return np.c_[np.convolve(ext[:, 0], w, 'valid'), np.convolve(ext[:, 1], w, 'valid')]

def corners(p, k=6, thr=38):
    n = len(p)
    a = p - np.roll(p, k, 0); b = np.roll(p, -k, 0) - p
    ang = np.degrees(np.abs(np.arctan2(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0], (a * b).sum(1))))
    idx = []
    for i in range(n):
        if ang[i] < thr: continue
        win = [ang[(i + j) % n] for j in range(-k, k + 1)]
        if ang[i] >= max(win) and not any(abs(i - j) < k or n - abs(i - j) < k for j in idx):
            idx.append(i)
    return sorted(idx)

def _bez(c, t):
    mt = 1 - t
    return (mt ** 3)[:, None] * c[0] + (3 * mt * mt * t)[:, None] * c[1] + (3 * mt * t * t)[:, None] * c[2] + (t ** 3)[:, None] * c[3]

def _bez_d(c, t):
    mt = 1 - t
    return (3 * mt * mt)[:, None] * (c[1] - c[0]) + (6 * mt * t)[:, None] * (c[2] - c[1]) + (3 * t * t)[:, None] * (c[3] - c[2])

def _bez_dd(c, t):
    return (6 * (1 - t))[:, None] * (c[2] - 2 * c[1] + c[0]) + (6 * t)[:, None] * (c[3] - 2 * c[2] + c[1])

def _chord(p):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    return d / d[-1]

def _gen(p, u, t1, t2):
    p0, p3 = p[0], p[-1]
    b0 = (1 - u) ** 3; b1 = 3 * u * (1 - u) ** 2; b2 = 3 * u * u * (1 - u); b3 = u ** 3
    A1 = b1[:, None] * t1; A2 = b2[:, None] * t2
    C = np.array([[(A1 * A1).sum(), (A1 * A2).sum()], [(A1 * A2).sum(), (A2 * A2).sum()]])
    tmp = p - (b0 + b1)[:, None] * p0 - (b2 + b3)[:, None] * p3
    X = np.array([(A1 * tmp).sum(), (A2 * tmp).sum()])
    det = C[0, 0] * C[1, 1] - C[0, 1] * C[1, 0]
    seg = np.linalg.norm(p3 - p0)
    if abs(det) > 1e-12:
        a1 = (X[0] * C[1, 1] - X[1] * C[0, 1]) / det; a2 = (C[0, 0] * X[1] - C[1, 0] * X[0]) / det
    else:
        a1 = a2 = seg / 3
    if a1 < 1e-6 * seg or a2 < 1e-6 * seg:
        a1 = a2 = seg / 3
    return np.array([p0, p0 + t1 * a1, p3 + t2 * a2, p3])

def _err(p, c, u):
    d = np.linalg.norm(_bez(c, u) - p, axis=1)
    i = int(np.argmax(d)); return d[i], i

def _reparam(p, c, u):
    q = _bez(c, u) - p; d1 = _bez_d(c, u); d2 = _bez_dd(c, u)
    num = (q * d1).sum(1); den = (d1 * d1).sum(1) + (q * d2).sum(1)
    un = u - np.where(np.abs(den) > 1e-12, num / den, 0)
    return np.clip(un, 0, 1)

def _unit(v):
    n = np.linalg.norm(v); return v / n if n > 1e-12 else v

def fit_cubic(p, t1, t2, tol):
    if len(p) < 3:
        s = np.linalg.norm(p[-1] - p[0]) / 3
        return [np.array([p[0], p[0] + t1 * s, p[-1] + t2 * s, p[-1]])]
    u = _chord(p); c = _gen(p, u, t1, t2); e, i = _err(p, c, u)
    if e < tol: return [c]
    if e < tol * 4:
        for _ in range(20):
            u = _reparam(p, c, u); c = _gen(p, u, t1, t2); e, i = _err(p, c, u)
            if e < tol: return [c]
    i = min(max(i, 2), len(p) - 3)
    tc = _unit(p[i - 2] - p[i + 2])
    return fit_cubic(p[:i + 1], t1, tc, tol) + fit_cubic(p[i:], -tc, t2, tol)

def _end_tangent(p, n=6):
    q = p[:min(n, len(p))]
    return _unit(q[-1] - q[0])

def straight(p, tol):
    a, b = p[0], p[-1]; d = _unit(b - a)
    dist = np.abs((p[:, 0] - a[0]) * d[1] - (p[:, 1] - a[1]) * d[0])
    return dist.max() < tol

def smooth_open(q, sig):
    """Gaussian smoothing of an open run with its end points held fixed."""
    if len(q) < 5: return q
    k = int(3 * sig) + 1
    w = np.exp(-0.5 * (np.arange(-k, k + 1) / sig) ** 2); w /= w.sum()
    # odd reflection about the end points keeps them (and straight runs) in place
    ext = np.vstack([2 * q[0] - q[k:0:-1], q, 2 * q[-1] - q[-2:-k - 2:-1]])
    r = np.c_[np.convolve(ext[:, 0], w, 'valid'), np.convolve(ext[:, 1], w, 'valid')]
    r[0], r[-1] = q[0], q[-1]
    return r

def fit_contour(raw, line_tol=1.0, curve_tol=0.8, k=6, thr=38, sig=2.5):
    p0 = smooth_closed(resample(raw, 0.5), 1.0)
    cs = corners(p0, k, thr)
    if cs:
        n0 = len(p0); p = p0.copy()
        for j, a in enumerate(cs):
            b = cs[(j + 1) % len(cs)]
            idx = np.arange(a, b + 1) if b > a else np.r_[np.arange(a, n0), np.arange(0, b + 1)]
            s = min(sig, max(0.5, len(idx) / 12))
            p[idx] = smooth_open(p0[idx], s)
    else:
        p = smooth_closed(p0, sig)
    n = len(p); segs = []
    if not cs:
        # smooth closed loop: start anywhere, keep tangent continuity
        cs = [0]; smooth_start = True
    else:
        smooth_start = False
    for j, a in enumerate(cs):
        b = cs[(j + 1) % len(cs)]
        idx = np.arange(a, b + 1) if b > a else np.r_[np.arange(a, n), np.arange(0, b + 1)]
        q = p[idx]
        if straight(q, line_tol):
            segs.append(('L', q[0], q[-1])); continue
        if smooth_start:
            t1 = _unit(p[1] - p[-1]); t2 = -t1
        else:
            t1 = _end_tangent(q); t2 = _end_tangent(q[::-1])
        for c in fit_cubic(q, t1, t2, curve_tol):
            # collapse near-straight cubics to lines
            d = _unit(c[3] - c[0]); off = [abs((c[m][0] - c[0][0]) * d[1] - (c[m][1] - c[0][1]) * d[0]) for m in (1, 2)]
            segs.append(('L', c[0], c[3]) if max(off) < 0.6 else ('C', c))
    return segs

def snap(segs, tol=1.6, minlen=8):
    """Make near-horizontal / near-vertical lines exact; propagate the moved endpoints to neighbours."""
    out = [list(s) for s in segs]
    def ends(s): return (s[1], s[2]) if s[0] == 'L' else (s[1][0], s[1][3])
    for i, s in enumerate(out):
        if s[0] != 'L': continue
        a, b = np.array(s[1], float), np.array(s[2], float)
        if np.linalg.norm(b - a) < minlen: continue
        if abs(b[1] - a[1]) < tol: y = (a[1] + b[1]) / 2; a[1] = b[1] = y
        elif abs(b[0] - a[0]) < tol: x = (a[0] + b[0]) / 2; a[0] = b[0] = x
        else: continue
        s[1], s[2] = a, b
        pv, nx = out[i - 1], out[(i + 1) % len(out)]
        if pv[0] == 'L': pv[2] = a
        else: c = np.array(pv[1]); c[2] += a - c[3]; c[3] = a; pv[1] = c
        if nx[0] == 'L': nx[1] = b
        else: c = np.array(nx[1]); c[1] += b - c[0]; c[0] = b; nx[1] = c
    return [tuple(s) for s in out]
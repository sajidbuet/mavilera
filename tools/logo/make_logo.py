# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
# Rights class: code. Development tool for the logo masters in logo/ (see tools/logo/README.md).
"""Build the MAVILERA logo SVGs from measured geometry (source-pixel coordinates of assets/mavilera-source.png)."""
import sys, os, json, math
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pathops
from fontTools.pens.svgPathPen import SVGPathPen
from geom import *

OUT = sys.argv[1]
FONTS = os.environ.get('MAVILERA_FONTS', os.path.join(HERE, 'fonts'))  # not committed: see README.md
NAVY, LIGHT, PALE, NEAR_WHITE = '#0B2A55', '#5B9BD5', '#C8E1F4', '#F2F5FA'
SUBTITLE = 'MICROPROCESSOR ARCHITECTURE VISUALIZER FOR INTERACTIVE LEARNING, EXECUTION, AND RUNTIME ANALYSIS'
SOURCE_SUBTITLE = 'MULTIARCHITECTURE VISUAL INTERACTIVE LEARNING AND EDUCATIONAL RESEARCH ASSISTANT'
class LazyFont:
    """A Font opened on first use, so that the header lockups (letters drawn, no font) build without the fonts."""
    def __init__(self, file): self._file, self._font = file, None
    def __getattr__(self, k):
        if self._font is None: self._font = Font(self._file)
        return getattr(self._font, k)

bold = LazyFont(os.path.join(FONTS, 'Montserrat-Bold.ttf'))
semi = LazyFont(os.path.join(FONTS, 'Montserrat-SemiBold.ttf'))
medium = LazyFont(os.path.join(FONTS, 'Montserrat-Medium.ttf'))
inter = LazyFont(os.path.join(FONTS, 'Inter-700.ttf'))
LCAP, LTRK = 20.5, -1.5

# ---------------------------------------------------------------- wordmark
T, B = 506.0, 674.0
LEG = 0.78          # dx/dy of the R leg (and the clip of the last A)

def letter_M(dx=0):
    c = 240.75
    pts = [(106, T), (164, T), (c, 579), (317.5, T), (375.5, T), (375.5, B), (324.25, B), (324.25, 565),
           (c, 644), (157.25, 565), (157.25, B), (106, B)]
    return poly([(x + dx, y) for x, y in pts])

def letter_A1(dx=0):
    c = 516.3
    return poly([(x + dx, y) for x, y in [(c - 130.4, B), (c - 75.5, B), (c, 568), (c + 75.5, B), (c + 130.4, B), (c + 17.25, T), (c - 17.25, T)]])

def tri_A1(dx=0):
    c = 516.3
    return poly([(c - 45.5 + dx, B), (c + 45.5 + dx, B), (c + dx, 608)])

def letter_V(dx=0):
    c = 706.8
    return poly([(x + dx, y) for x, y in [(c - 130.9, T), (c - 72.3, T), (c, 611.5), (c + 72.3, T), (c + 130.9, T), (c + 20.3, B), (c - 20.3, B)]])

def letter_I(dx=0):
    return rect(851 + dx, T, 50.5, B - T)

def letter_L(dx=0):
    b = Builder()
    b.M((933 + dx, T)).L((933 + dx, B - 38)).A((971 + dx, B - 38), 38, math.pi, math.pi / 2)
    b.L((1083.5 + dx, B)).L((1083.5 + dx, 628)).L((991 + dx, 628)).A((991 + dx, 621), 7, math.pi / 2, math.pi)
    b.L((984 + dx, T)).Z()
    return b.path

def letter_E(dx=0):
    pts = [(1099, T), (1099, B), (1256.5, B), (1256.5, 628), (1151, 628), (1151, 610), (1226.7, 610), (1226.7, 570),
           (1151, 570), (1151, 553), (1256.5, 553), (1256.5, T)]
    return poly([(x + dx, y) for x, y in pts])

def letter_R(dx=0):
    cx, cy, r = 1393.0, 563.0, 57.0
    # bowl circle meets the right edge of the leg: x = 1445.8 - LEG*(B - y)
    lo, hi = 0.0, math.pi / 2
    f = lambda a: (cx + r * math.cos(a)) - (1445.8 - LEG * (B - (cy + r * math.sin(a))))
    for _ in range(60):
        mid = (lo + hi) / 2
        if f(lo) * f(mid) <= 0: hi = mid
        else: lo = mid
    a1 = (lo + hi) / 2
    b = Builder()
    b.M((1276 + dx, T)).L((cx + dx, T)).A((cx + dx, cy), r, -math.pi / 2, a1)
    b.L((1445.8 + dx, B)).L((1386.2 + dx, B)).L((1386.2 - LEG * 54 + dx, 620)).L((1327 + dx, 620)).L((1327 + dx, B)).L((1276 + dx, B)).Z()
    outer = b.path
    h = Builder(); rc = 11.6; ccy = 564.6
    h.M((1327 + dx, ccy - rc)).L((1386.4 + dx, ccy - rc)).A((1386.4 + dx, ccy), rc, -math.pi / 2, math.pi / 2).L((1327 + dx, ccy + rc)).Z()
    return diff(outer, h.path)

def letter_A2(dx=0):
    c = 1559.3
    pts = [(c + 16.25, T), (1671.8, 666.2), (1671.8, B), (c + 68.9, B), (c, 568), (c - 68.9, B), (1453.2, B),
           (1453.2 - LEG * 8.1, B - 8.1), (c - 16.25, T)]
    return poly([(x + dx, y) for x, y in pts])

def tri_A2(dx=0):
    c = 1559.3
    return poly([(c - 41.7 + dx, B), (c + 41.7 + dx, B), (c + dx, 609)])

def letter_S(x0):
    """Geometric S in the wordmark's construction: bowls like the R (outer r 52.5, inner r 8.5)."""
    xr = x0 + 150; ro, ri = 52.5, 8.5; st, sb = 569.0, 611.0
    b = Builder()
    b.M((xr, T)).L((x0 + ro, T)).A((x0 + ro, T + ro), ro, -math.pi / 2, -1.5 * math.pi)
    b.L((xr - 59.5, sb)).A((xr - 59.5, sb + ri), ri, -math.pi / 2, math.pi / 2)
    b.L((x0, 628)).L((x0, B)).L((xr - ro, B)).A((xr - ro, B - ro), ro, math.pi / 2, -math.pi / 2)
    b.L((x0 + 59.5, st)).A((x0 + 59.5, st - ri), ri, math.pi / 2, 1.5 * math.pi)
    b.L((xr, 552)).Z()
    return b.path

def letter_C(x0):
    xr = x0 + 150; ro, ri = 52.5, 8.5
    b = Builder()
    b.M((xr, T)).L((x0 + ro, T)).A((x0 + ro, T + ro), ro, -math.pi / 2, -math.pi)
    b.L((x0, B - ro)).A((x0 + ro, B - ro), ro, math.pi, math.pi / 2)
    b.L((xr, B)).L((xr, 628)).L((x0 + 59.5, 628)).A((x0 + 59.5, 628 - ri), ri, math.pi / 2, math.pi)
    b.L((x0 + 51, 552 + ri)).A((x0 + 59.5, 552 + ri), ri, math.pi, 1.5 * math.pi)
    b.L((xr, 552)).Z()
    return b.path

def hyphen(x0):
    """The hyphen: the E's middle arm, 72 wide."""
    return rect(x0, 570, 72, 40)

PIN, PIN_W = 22.0, 16.0

def chip(x0):
    """Microprocessor symbol, cap height tall: a body with three pins a side, a die window and its core.
    Returns (body and pins, core); x0 is the left end of the left pins."""
    s = B - T - 2 * PIN; bx, by = x0 + PIN, T + PIN; c = (bx + s / 2, by + s / 2)
    parts = [rrect(bx, by, s, s, 14)]
    for k in (-36, 0, 36):
        parts += [rect(c[0] + k - PIN_W / 2, T, PIN_W, PIN + 2), rect(c[0] + k - PIN_W / 2, B - PIN - 2, PIN_W, PIN + 2),
                  rect(x0, c[1] + k - PIN_W / 2, PIN + 2, PIN_W), rect(bx + s - 2, c[1] + k - PIN_W / 2, PIN + 2, PIN_W)]
    body = diff(union(parts), rrect(c[0] - 30, c[1] - 30, 60, 60, 6))
    core = rrect(c[0] - 16, c[1] - 16, 32, 32, 3)
    return body, core

def riscv_header(x):
    """'RISC-V' in the wordmark's construction from x; returns (path, right edge)."""
    R = letter_R(x - 1276); x += 173.8 + 26
    I = letter_I(x - 851); x += 50.5 + 28
    S = letter_S(x); x += 150 + 24
    C = letter_C(x); x += 150 + 22
    H = hyphen(x); x += 72 + 22
    V = letter_V(x - 575.9); x += 261.8
    return union([R, I, S, C, H, V]), x

def letter_P(x0):
    """P in the wordmark's construction: the R's stem, bowl (r 57) and counter, without the leg."""
    cx, cy, r = x0 + 117.0, 563.0, 57.0
    b = Builder()
    b.M((x0, T)).L((cx, T)).A((cx, cy), r, -math.pi / 2, math.pi / 2)
    b.L((x0 + 51, cy + r)).L((x0 + 51, B)).L((x0, B)).Z()
    h = Builder(); rc = 11.6; ccy = 564.6
    h.M((x0 + 51, ccy - rc)).L((x0 + 110.4, ccy - rc)).A((x0 + 110.4, ccy), rc, -math.pi / 2, math.pi / 2).L((x0 + 51, ccy + rc)).Z()
    return diff(b.path, h.path)

def digit_1(x0):
    """1: a stem as wide as the I with a flag slanting down to the left, as thick as the E's arms."""
    xs = x0 + 50
    return union([rect(xs, T, 50.5, B - T), poly([(x0, T + 40), (xs, T), (xs, T + 40), (x0, T + 80)])])

def digit_2(x0):
    """2 in the S's construction, 150 wide: the S's upper bowl mirrored (outer r 52.5, inner r 8.5), its middle bar
    running to a left stem as wide as the P's (51) with a square corner, and the S's bottom bar."""
    xr = x0 + 150; ro, ri = 52.5, 8.5; st, sb = 569.0, 611.0
    b = Builder()
    b.M((x0, T)).L((xr - ro, T)).A((xr - ro, T + ro), ro, -math.pi / 2, math.pi / 2)
    b.L((x0 + 51, sb)).L((x0 + 51, 628)).L((xr, 628)).L((xr, B)).L((x0, B)).L((x0, st))
    b.L((xr - 59.5, st)).A((xr - 59.5, st - ri), ri, math.pi / 2, -math.pi / 2)
    b.L((x0, 552)).Z()
    return b.path

def sap_header(x, n):
    """'SAP-1' or 'SAP-2' (n) in the wordmark's construction from x; returns (path, right edge)."""
    if n == 1: return sap1_header(x)
    S = letter_S(x); x += 150 + 24
    A = union([letter_A1(x + 130.4 - 516.3), tri_A1(x + 130.4 - 516.3)]); x += 260.8 + 18
    P = letter_P(x); x += 174 + 22
    H = hyphen(x); x += 72 + 22
    two = digit_2(x); x += 150
    return union([S, A, P, H, two]), x

def sap1_header(x):
    """'SAP-1' in the wordmark's construction from x; returns (path, right edge). The A is the wordmark's first A
    with its triangle, in one colour."""
    S = letter_S(x); x += 150 + 24
    A = union([letter_A1(x + 130.4 - 516.3), tri_A1(x + 130.4 - 516.3)]); x += 260.8 + 18
    P = letter_P(x); x += 174 + 22
    H = hyphen(x); x += 72 + 22
    one = digit_1(x); x += 100.5
    return union([S, A, P, H, one]), x

XH = 0.72          # the x-height of a lower-case letter, as a fraction of the cap height (the v of ARMv7)

def letter_v_small(x0):
    """v: the V's construction scaled to the x-height about the baseline (stroke widths scaled with it)."""
    c = 706.8; top = B - XH * (B - T)
    pts = [(c - 130.9, T), (c - 72.3, T), (c, 611.5), (c + 72.3, T), (c + 130.9, T), (c + 20.3, B), (c - 20.3, B)]
    return poly([(x0 + XH * (x - (c - 130.9)), B - XH * (B - y)) for x, y in pts]), x0 + XH * 261.8

def digit_7(x0):
    """7, 150 wide: a top bar as thick as the E's arms (47) and a stem as wide as the I (50.5) slanting to the
    baseline."""
    return poly([(x0, T), (x0 + 150, T), (x0 + 150, T + 47), (x0 + 96, B), (x0 + 45.5, B), (x0 + 98.5, T + 47), (x0, T + 47)])

def armv7_header(x):
    """'ARMv7' in the wordmark's construction from x; returns (path, right edge). The A is the wordmark's first A
    with its triangle, in one colour; the v is lower case, as ARM writes the name."""
    A = union([letter_A1(x + 130.4 - 516.3), tri_A1(x + 130.4 - 516.3)]); x += 260.8 + 18
    R = letter_R(x - 1276); x += 169.8 + 22
    M = letter_M(x - 106); x += 269.5 + 22
    v, x = letter_v_small(x); x += 20
    seven = digit_7(x); x += 150
    return union([A, R, M, v, seven]), x

def wordmark():
    navy = union([letter_M(), letter_A1(), letter_V(), letter_I(), letter_L(), letter_E(), letter_R(), letter_A2()])
    light = union([tri_A1(), tri_A2()])
    return navy, light

# ---------------------------------------------------------------- mark (fitted)
def mark_shapes():
    data = json.load(open(os.path.join(HERE, 'mark.json')))
    out = {}
    for name in ('navy', 'light'):
        shapes = data[name]; p = new(); b = Builder(p)
        for segs in shapes:
            first = segs[0][1][0]; b.M(first)
            for kind, pts in segs:
                if kind == 'L': b.L(pts[1])
                else: b.C(pts[1], pts[2], pts[3])
            b.Z()
        p.fillType = pathops.FillType.EVEN_ODD
        p.simplify(fix_winding=True)
        out[name] = p
    return out['navy'], out['light']

# ---------------------------------------------------------------- circuit traces
W = 10.8
LCUT = ('cut', (471.3, 303.2), (-0.4259, 1.0))      # parallel to the M's left leg
RCUT = ('cut', (1113.7, 283.0), (0.3575, 1.0))      # parallel to the M's right leg
SLOPE = 1.9                                         # S-bends: dy/dx of the diagonal

def sbend(y0, y1, xc, r=30, x0=327.0, x1=520.0, width=W):
    ym = (y0 + y1) / 2; half = abs(y1 - y0) / 2 / SLOPE
    return trace([(x0, y0), (xc - half, y0), (xc + half, y1), (x1, y1)], [r, r], width, None, LCUT)

def left_traces():
    navy = [sbend(232.0, 282.8, 396.6), sbend(278.5, 315.4, 374.0), sbend(426.3, 381.4, 374.6)]
    light = [sbend(381.4, 347.9, 369.5),
             union([rect(327, 325, 28, 12), poly([(355, 319), (370.8, 331), (355, 343)])])]
    return navy, light

DASH_X = (1484.6, 1511.6, 1538.0); DASH_W = 14.4

def right_traces(full=True, xmax=None):
    navy, light = [], []
    navy.append(trace([(1080, 266.4), (1167.5, 266.4), (1223.2, 223.4), (1317.8, 223.4)], [5, 5], W, RCUT, None))
    r2 = trace([(1080, 297.4), (1174.5, 297.4), (1224.7, 256.4), (1472.6, 256.4)], [5, 5], W, RCUT, None)
    navy.append(diff(r2, circle((1388.6, 250.5), 12.5)))
    navy.append(trace([(1080, 381.4), (1175.5, 381.4), (1224.7, 423.4), (1472.8, 423.4)], [5, 5], W, RCUT, None))
    navy.append(trace([(1080, 413.0), (1172.5, 413.0), (1224.0, 451.4), (1375.4, 451.4)], [5, 5], W, RCUT, 'round'))
    light.append(trace([(1387.9, 250.4), (1387.9, 230.9), (1472.6, 230.9)], [9], W, 'round', None))
    light.append(trace([(1472.6, 450.9), (1394.2, 450.9), (1394.2, 443.4)], [5], W, None, 'round'))
    ring = diff(rrect(1325.1, 207.6, 31.6, 31.6, 3.5), rect(1333.1, 215.6, 15.6, 15.6))
    navy.append(ring)
    for i, x in enumerate(DASH_X):
        (navy if i == 2 else light).append(rect(x, 230.9 - W / 2, DASH_W, W))
        if i < 2:
            navy.append(rect(x, 256.4 - W / 2, DASH_W, W)); navy.append(rect(x, 423.4 - W / 2, DASH_W, W))
        light.append(rect(x, 450.9 - W / 2, DASH_W, W))
    d47 = (math.cos(math.radians(47)), math.sin(math.radians(47)))
    navy.append(trace([(1538.0, 256.4), (1576.3, 256.4), (1576.3 + 45 * d47[0], 256.4 + 45 * d47[1])], [4], W, None, ('cut', (0, 279.6), (1, 0))))
    navy.append(trace([(1538.0, 423.4), (1576.3, 423.4), (1576.3 + 45 * d47[0], 423.4 - 45 * d47[1])], [4], W, None, ('cut', (0, 399.1), (1, 0))))
    # big arrow from the M into IF
    def cutx(y): return 1113.7 + 0.3575 * (y - 283.0)
    light.append(poly([(cutx(325.2), 325.2), (1181.5, 325.2), (1181.5, 319.0), (1203.8, 339.5), (1181.5, 360.0),
                       (1181.5, 353.8), (cutx(353.8), 353.8)]))
    navy, light = union(navy), union(light)
    if xmax is not None:
        clip = rect(0, 0, xmax, 900)
        navy = pathops.op(navy, clip, pathops.PathOp.INTERSECTION); light = pathops.op(light, clip, pathops.PathOp.INTERSECTION)
    return navy, light

# ---------------------------------------------------------------- instruction list
INSTR = ['ADD', 'LW', 'SW', 'BEQ', 'JAL']

def instructions():
    navy, light, pale = [], [], []
    for i, name in enumerate(INSTR):
        y = 210.1 + 50.2 * i; yc = y + 21.4
        box = rrect(106, y, 212.8, 42.4, 7)
        slot = pill(199.8, 302.2, yc, 11)
        label, _ = inter.text(name, 124.0, y + 31.9, LCAP, LTRK)
        navy.append(diff(diff(box, slot), label))
        light.append(pill(199.8, 253.6, yc, 11, True, False))
        if name in ('LW', 'SW'):
            pale.append(pill(253.6, 302.2, yc, 11, False, True))
    return union(navy), union(light), union(pale)

# ---------------------------------------------------------------- pipeline
STAGES = [('IF', 1209.0, 1283.8, 'n'), ('ID', 1300.0, 1376.8, 'l'), ('EX', 1392.0, 1468.8, 'n'),
          ('MEM', 1484.0, 1569.8, 'l'), ('WB', 1586.0, 1669.8, 'n')]
PY0, PY1, AY = 287.0, 391.8, 339.8

def pipeline():
    navy, light = [], []
    for i, (name, x0, x1, col) in enumerate(STAGES):
        box = rrect(x0, PY0, x1 - x0, PY1 - PY0, 8)
        if i > 0:
            box = diff(box, poly([(x0 - 1, AY - 8.3), (x0 + 7.8, AY), (x0 - 1, AY + 8.3)]))
        if i < 4:
            nx0 = STAGES[i + 1][1]; tip = nx0 + 1.8; base = tip - 10.5
            if col == 'n':
                box = diff(box, rect(x1 - 5.0, AY - 6.5, 20, 13))
                s0 = x1 - 4.4
            else:
                s0 = x1 - 6
            light.append(union([rect(s0, AY - 5.8, base - s0, 11.6), poly([(base, AY - 10), (tip, AY), (base, AY + 10)])]))
        cap = 21.5
        w = inter.measure(name, cap, LTRK)
        label, _ = inter.text(name, (x0 + x1) / 2 + 0.5 - w / 2, 351.0, cap, LTRK)
        box = diff(box, label)
        (navy if col == 'n' else light).append(box)
    return union(navy), union(light)

# ---------------------------------------------------------------- subtitle and bars
def subtitle(text=SUBTITLE):
    # tracking/cap ratio of the source line, measured by fitting the source text to its measured width
    src_w, src_cap = 1671.8 - 105.5, 17.0
    n0 = len(SOURCE_SUBTITLE) - 1
    t_src = (src_w - medium.measure(SOURCE_SUBTITLE, src_cap)) / n0
    ratio = t_src / src_cap
    n1 = len(text) - 1
    unit = medium.measure(text, 1.0)
    cap = src_w / (unit + ratio * n1)
    base = 703.5 + cap / 2
    p, right = medium.text(text, 105.5, base, cap, ratio * cap)
    return p, dict(cap=cap, tracking=ratio * cap, src_tracking=t_src, right=right)

def bars():
    navy = [pill(336, 771, 754.2, 6.4), pill(1007, 1441, 754.2, 6.4), rect(801, 741, 27, 27), rect(946, 741, 27, 27)]
    light = [rect(849.5, 741, 27, 27), rect(898, 741, 27, 27)]
    return union(navy), union(light)

# ---------------------------------------------------------------- SVG output
def d_of(path):
    pen = SVGPathPen(None, ntos=lambda v: ('%.2f' % v).rstrip('0').rstrip('.'))
    path.draw(pen); return pen.getCommands()

HEADER = ('<!--! Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. '
          'Rights class: content (Apache-2.0). The name MAVILERA is not licensed as a trademark (TRADEMARKS.md). '
          '-->')
FONT_NOTE = ' Subtitle and labels: outlines of Montserrat and Inter (SIL Open Font License 1.1, THIRD_PARTY.md).'

def svg(layers, box, title, dark=False):
    x, y, w, h = box
    hdr = HEADER.replace('-->', (FONT_NOTE if any(k == 'p' for k, _ in layers) else '') + ' -->')
    pal = {'n': NEAR_WHITE if dark else NAVY, 'l': LIGHT, 'p': PALE}
    used = [k for k, p in layers if p is not None]
    style = ''.join('.%s{fill:%s}' % (k, pal[k]) for k in dict.fromkeys(used))
    body = ''.join('<path class="%s" d="%s"/>' % (k, d_of(p)) for k, p in layers if p is not None)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s %s %s %s" role="img" aria-label="%s">%s'
            '<style>%s</style>%s</svg>\n') % (fmt(x), fmt(y), fmt(w), fmt(h), title, hdr, style, body)

def fmt(v): return ('%.2f' % v).rstrip('0').rstrip('.')

def bounds(paths):
    bs = [p.bounds for p in paths if p is not None and p.bounds != (0, 0, 0, 0)]
    return min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs)

def padded(b, pad, square=False):
    x0, y0, x1, y1 = b; w, h = x1 - x0, y1 - y0
    if square:
        s = max(w, h); cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        return (cx - s / 2 - pad, cy - s / 2 - pad, s + 2 * pad, s + 2 * pad)
    return (x0 - pad, y0 - pad, w + 2 * pad, h + 2 * pad)

def module_headers(only):
    """The tool-header lockups of the modules named in `only` (no fonts needed): {file name: svg}."""
    wn, wl = wordmark()
    cx0 = 1671.8 + 60; body, core = chip(cx0)
    x = cx0 + 2 * PIN + (B - T - 2 * PIN) + 60
    make = {'armv7': (lambda: armv7_header(x)[0], 'mavilera-armv7-header', 'MAVILERA ARMv7')}  # ARM-A2 (W-D35)
    files = {}
    for key in only:
        build, name, title = make[key]
        h = build()
        for dark in (False, True):
            files['%s%s.svg' % (name, '-dark' if dark else '')] = svg([('n', union([wn, core])), ('l', union([wl, body, h]))],
                                                                    padded(bounds([wn, body, h]), 12), title, dark)
    return files

def main():
    os.makedirs(OUT, exist_ok=True)
    if '--only' in sys.argv:  # python -I make_logo.py OUT --only armv7: those header lockups alone
        for k, v in module_headers(sys.argv[sys.argv.index('--only') + 1].split(',')).items():
            open(os.path.join(OUT, k), 'w', encoding='utf-8', newline='\n').write(v)
        return
    wn, wl = wordmark()
    mn, ml = mark_shapes()
    ltn, ltl = left_traces()
    rtn, rtl = right_traces()
    inn, inl, inp = instructions()
    pn, pl = pipeline()
    sub, info = subtitle()
    bn, bl = bars()
    full_n = union([wn, mn, union(ltn), rtn, inn, pn, sub, bn])
    full_l = union([wl, ml, union(ltl), rtl, inl, pl, bl])
    files = {}
    files['mavilera-full.svg'] = svg([('n', full_n), ('l', full_l), ('p', inp)],
                                     padded(bounds([full_n, full_l]), 24), 'MAVILERA')
    # mark: the M with its connector traces, cut where the instruction boxes and the pipeline begin
    rmn, rml = right_traces(xmax=1209.0)
    mk_n = union([mn, union(ltn), rmn]); mk_l = union([ml, union(ltl), rml])
    mb = padded(bounds([mk_n, mk_l]), 16, square=True)
    for dark in (False, True):
        sfx = '-dark' if dark else ''
        files['mavilera-mark%s.svg' % sfx] = svg([('n', mk_n), ('l', mk_l)], mb, 'MAVILERA', dark)
        files['mavilera-wordmark%s.svg' % sfx] = svg([('n', wn), ('l', wl)], padded(bounds([wn]), 12), 'MAVILERA', dark)
    # app lockup: MAVILERA : RISCV
    xc = 1671.8 + 56; colon = union([rect(xc, 628, 46, 46), rect(xc, 540, 46, 46)])
    x = xc + 46 + 56
    r_dx = x - 1276; R = letter_R(r_dx); x += 173.8 + 26
    I = letter_I(x - 851); x += 50.5 + 28
    S = letter_S(x); x += 150 + 24
    C = letter_C(x); x += 150 + 20
    V = letter_V(x - 575.9)
    rv = union([R, I, S, C, V])
    lock_n = union([wn, colon])
    for dark in (False, True):
        sfx = '-dark' if dark else ''
        files['mavilera-riscv%s.svg' % sfx] = svg([('n', lock_n), ('l', union([wl, rv]))],
                                                 padded(bounds([lock_n, rv]), 12), 'MAVILERA : RISCV', dark)
    # tool header lockup: MAVILERA, the microprocessor symbol, RISC-V (all cap height)
    cx0 = 1671.8 + 60; body, core = chip(cx0)
    rvh, _ = riscv_header(cx0 + 2 * PIN + (B - T - 2 * PIN) + 60)
    for dark in (False, True):
        sfx = '-dark' if dark else ''
        files['mavilera-riscv-header%s.svg' % sfx] = svg([('n', union([wn, core])), ('l', union([wl, body, rvh]))],
                                                        padded(bounds([wn, body, rvh]), 12), 'MAVILERA RISC-V', dark)
    # the same lockup of the SAP-1 module (phase 5 of the architecture contract, W-D29; author, 2026-10-29)
    sph, _ = sap1_header(cx0 + 2 * PIN + (B - T - 2 * PIN) + 60)
    for dark in (False, True):
        sfx = '-dark' if dark else ''
        files['mavilera-sap1-header%s.svg' % sfx] = svg([('n', union([wn, core])), ('l', union([wl, body, sph]))],
                                                       padded(bounds([wn, body, sph]), 12), 'MAVILERA SAP-1', dark)
    # and of the SAP-2 module (SAP-2 plan §8, decision 3; author, 2026-10-30)
    s2h, _ = sap_header(cx0 + 2 * PIN + (B - T - 2 * PIN) + 60, 2)
    for dark in (False, True):
        sfx = '-dark' if dark else ''
        files['mavilera-sap2-header%s.svg' % sfx] = svg([('n', union([wn, core])), ('l', union([wl, body, s2h]))],
                                                       padded(bounds([wn, body, s2h]), 12), 'MAVILERA SAP-2', dark)
    # application icon: the microprocessor symbol of the header lockup (square, legible at 16 px)
    ib = padded(bounds([body]), 6, square=True)
    for dark in (False, True):
        sfx = '-dark' if dark else ''
        files['mavilera-icon%s.svg' % sfx] = svg([('n', core), ('l', body)], ib, 'MAVILERA', dark)
    # narrow screens: the full logo without the subtitle and its bars (the page sets the expansion as text)
    files['mavilera-lockup.svg'] = svg([('n', union([wn, mn, union(ltn), rtn, inn, pn])), ('l', full_l_nobars := union([wl, ml, union(ltl), rtl, inl, pl])), ('p', inp)],
                                       padded(bounds([wn, mn, rtn, inn, pn, full_l_nobars]), 24), 'MAVILERA')
    for k, v in files.items():
        open(os.path.join(OUT, k), 'w', encoding='utf-8', newline='\n').write(v)
    print(json.dumps(info))

if __name__ == '__main__':
    main()

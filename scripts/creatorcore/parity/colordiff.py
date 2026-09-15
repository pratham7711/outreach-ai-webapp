"""Colour parity: same unique-key pairing as score.py, but comparing the
computed text colour instead of the box.  Geometry and colour are separate
questions -- a label can sit exactly on theirs and still be the wrong ink."""
import json, os, sys, re
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score import PAIRS, REF  # noqa: E402

def rgba(s):
    """Two branches, never one regex: Chrome serialises a color-mix() result as
    `color(srgb 0.9 0.68 0)` with 0-1 floats, and reading those as 0-255 turns
    an amber into near-black.  See the color-mix-breaks-rgb-parsers note."""
    if not s:
        return None
    m = re.findall(r"[-+]?\d*\.?\d+", s)
    if len(m) < 3:
        return None
    vals = [float(x) for x in m]
    if s.strip().startswith("color("):
        r, g, b = (v * 255 for v in vals[:3])
        a = vals[3] if len(vals) > 3 else 1.0
    else:
        r, g, b = vals[:3]
        a = vals[3] if len(vals) > 3 else 1.0
    return (r, g, b, a)

def over_white(c):
    """Flatten onto the page so an alpha ink compares against a solid one."""
    r, g, b, a = c
    return tuple(round(v * a + 255 * (1 - a)) for v in (r, g, b))

def uni_text(p):
    c = json.load(open(p)); m = defaultdict(list); cnt = Counter()
    for i in c["items"]:
        if i["kind"] != "text" or i["x"] < 255 or not i.get("color"):
            continue
        cnt[i["key"]] += 1; m[i["key"]].append(i)
    return {k: v[0] for k, v in m.items() if cnt[k] == 1}

OUR = sys.argv[1]
tot = same = 0
for tid, oid in PAIRS:
    pt = os.path.join(REF, tid + ".census.json"); po = os.path.join(OUR, oid + ".census.json")
    if not (os.path.exists(pt) and os.path.exists(po)):
        continue
    t, o = uni_text(pt), uni_text(po)
    rows = []
    for k, ti in t.items():
        ui = o.get(k)
        if not ui:
            continue
        a, b = rgba(ti["color"]), rgba(ui["color"])
        if not a or not b:
            continue
        tot += 1
        fa, fb = over_white(a), over_white(b)
        d = max(abs(x - y) for x, y in zip(fa, fb))
        if d <= 12:
            same += 1
        else:
            rows.append((k, ti["color"], ui["color"], d))
    if rows:
        print(f"\n### {oid}  ({len(rows)} off)")
        for k, tc, uc, d in sorted(rows, key=lambda r: -r[3]):
            print(f"  {k[:40]:42} THEIRS {tc:28} OURS {uc:28} d={d:.0f}")
print(f"\nTOTAL {tot-same}/{tot} text keys off-colour")

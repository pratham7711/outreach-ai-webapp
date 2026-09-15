"""Every still-moved key, with both sides' numbers, so a cluster is visible as a
cluster.  Same unique-key + x>=255 + 4px rule as score.py -- this is score.py's
verbose sibling, not a second opinion."""
import json, os, sys
from collections import Counter
REF = "scripts/creatorcore/out/parity/2026-09-14T14-31-27/desktop-1600"
OUR = sys.argv[1]
ONLY = sys.argv[2] if len(sys.argv) > 2 else None
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score import PAIRS, uni  # noqa: E402
for tid, oid in PAIRS:
    if ONLY and ONLY not in oid:
        continue
    pt = os.path.join(REF, tid + ".census.json")
    po = os.path.join(OUR, oid + ".census.json")
    if not (os.path.exists(pt) and os.path.exists(po)):
        continue
    t, o = uni(pt), uni(po)
    hits = []
    for k, ti in t.items():
        ui = o.get(k)
        if not ui:
            continue
        d = [ui[f] - ti[f] for f in ("x", "y", "w", "h")]
        if max(abs(v) for v in d) > 4:
            hits.append((k, ti, ui, d))
    if not hits:
        continue
    print(f"\n### {oid}  ({len(hits)})")
    for k, ti, ui, d in sorted(hits, key=lambda h: h[1]["y"]):
        print(f"  {k[:46]:48} THEIRS {ti['x']:7.1f},{ti['y']:7.1f} {ti['w']:6.1f}x{ti['h']:5.1f} fs={ti.get('fs')}")
        print(f"  {'':48} OURS   {ui['x']:7.1f},{ui['y']:7.1f} {ui['w']:6.1f}x{ui['h']:5.1f} fs={ui.get('fs')}")
        print(f"  {'':48} d      {d[0]:+7.1f},{d[1]:+7.1f} {d[2]:+6.1f}x{d[3]:+5.1f}")

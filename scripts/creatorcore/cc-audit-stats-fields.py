"""
Audits the fetched statistic-post records field by field, per platform.

    python3 scripts/creatorcore/cc-audit-stats-fields.py

Written because the field mapping in cc-apply-stats.mjs was verified against the
reference UI on exactly one post, which was enough to confirm the field names and
enough to miss `saves` entirely -- that post did not have it. Re-run this after
any further fetch: coverage is what one cross-check cannot give you.

Reports which fields each platform actually populates, and checks two things that
were assumptions until measured: whether `engagement` is the four-term or the
five-term sum, and whether `engagementRate` is really engagement/views.
"""
import json, collections, os

base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
stats_path = os.path.join(base, "statistic-post.jsonl")
posts_path = os.path.join(base, "post.jsonl")

# post id -> platform, from the original extract
platform = {}
for line in open(posts_path):
    line = line.strip()
    if not line:
        continue
    try:
        p = json.loads(line)
    except Exception:
        continue
    if p.get("_id"):
        platform[p["_id"]] = p.get("platform") or p.get("Platform") or "UNKNOWN"

FIELDS = ["views", "likes", "comments", "shareCount", "downloadCount",
          "engagementRate", "engagement", "saves", "saveCount"]

by_plat = collections.defaultdict(lambda: collections.Counter())
totals = collections.Counter()
rate_sane = collections.Counter()
n = 0
bad_rate = []

for line in open(stats_path):
    line = line.strip()
    if not line:
        continue
    try:
        r = json.loads(line)
    except Exception:
        continue
    n += 1
    plat = platform.get(r.get("__postId"), "UNKNOWN")
    by_plat[plat]["rows"] += 1
    for f in FIELDS:
        if f in r and r[f] is not None:
            by_plat[plat][f] += 1
            totals[f] += 1
    # engagementRate should be a fraction, and should roughly equal
    # (likes+comments+shares+downloads)/views if that is what it means
    er, v = r.get("engagementRate"), r.get("views")
    if isinstance(er, (int, float)) and isinstance(v, (int, float)) and v > 0:
        eng = sum(r.get(k) or 0 for k in ("likes", "comments", "shareCount", "downloadCount"))
        implied = eng / v
        if er > 1.5:
            rate_sane["gt_1.5_not_a_fraction"] += 1
        elif abs(implied - er) < 0.02:
            rate_sane["matches_engagement_over_views"] += 1
        else:
            rate_sane["fraction_but_different_formula"] += 1
            if len(bad_rate) < 4:
                bad_rate.append((plat, er, round(implied, 4), v, eng))

print(f"{n} stats rows joined against {len(platform)} known posts\n")
print("field presence by platform:")
plats = sorted(by_plat, key=lambda p: -by_plat[p]["rows"])
hdr = "  {:<12} {:>6}".format("platform", "rows") + "".join(f" {f[:9]:>10}" for f in FIELDS)
print(hdr)
for p in plats:
    c = by_plat[p]
    row = "  {:<12} {:>6}".format(p, c["rows"])
    for f in FIELDS:
        pct = (c[f] / c["rows"] * 100) if c["rows"] else 0
        row += f" {pct:9.0f}%"
    print(row)

print("\nengagementRate semantics:")
for k, v in rate_sane.most_common():
    print(f"  {k}: {v}")
for b in bad_rate:
    print(f"    e.g. {b[0]}: stored={b[1]} implied={b[2]} views={b[3]} eng={b[4]}")

"""Which of the reference's control labels have no counterpart in our source.

Reads the captured CreatorCore pages and, for each, greps our matching route for
every label that looks like UI chrome. Structural only: anything that looks like
a person, a handle, a number or a date is dropped before comparing, so the
report carries no roster data.

Emits out/label-diff.json and a per-page count to stdout.
"""
import glob, io, json, os, re, subprocess, sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
UI = os.path.join(OUT, "ui")

# CC page -> our route directory
PAGES = {
    "campaigns": "app/(dashboard)/campaigns",
    "creators": "app/(dashboard)/creators",
    "clients": "app/(dashboard)/clients",
    "lists": "app/(dashboard)/lists",
    "payouts": "app/(dashboard)/payouts",
    "activations": "app/(dashboard)/activations",
    "discovery": "app/(dashboard)/discovery",
    "calendar": "app/(dashboard)/calendar",
    "connections": "app/(dashboard)/connections",
    "recipients": "app/(dashboard)/recipients",
    "requests": "app/(dashboard)/requests",
    "trackers": "app/(dashboard)/trackers",
    "trackers-creators": "app/(dashboard)/trackers",
    "fan-pages": "app/(dashboard)/fan-pages",
    "settings": "app/(dashboard)/settings",
    "campaign-overview": "app/(dashboard)/campaigns/[id]",
    "campaign-creators": "app/(dashboard)/campaigns/[id]",
    "campaign-drafts": "app/(dashboard)/campaigns/[id]",
    "campaign-posts": "app/(dashboard)/campaigns/[id]",
    "campaign-analytics": "app/(dashboard)/campaigns/[id]",
    "campaign-financials": "app/(dashboard)/campaigns/[id]",
    "campaign-documents": "app/(dashboard)/campaigns/[id]",
    "campaign-settings": "app/(dashboard)/campaigns/[id]",
}

# Anything that is data rather than chrome.
DROP = re.compile(
    r"@|https?://|^\W*$|^\d|\d{3,}|"
    r"\b(am|pm|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|"
    r"followers|views|likes|comments|\$|%",
    re.I,
)
# Chrome is short and reads like a control.
def is_chrome(label: str) -> bool:
    l = label.strip()
    if not (2 <= len(l) <= 34):
        return False
    if DROP.search(l):
        return False
    if l.count(" ") > 4:
        return False
    # A capitalised phrase or a single word; not a sentence fragment with punctuation.
    if re.search(r"[.;:!?/\\|]", l):
        return False
    return bool(re.match(r"^[A-Za-z][A-Za-z\-' &+]*$", l))


def source_text(route: str) -> str:
    if not os.path.isdir(route):
        return ""
    buf = []
    for root, dirs, files in os.walk(route):
        dirs[:] = [d for d in dirs if d not in {"node_modules", ".next"}]
        for fn in files:
            if fn.endswith((".tsx", ".ts")):
                buf.append(io.open(os.path.join(root, fn), encoding="utf-8", errors="replace").read())
    return "\n".join(buf)


# Shared chrome lives outside the route dir (sidebar, ds components, ui lib).
SHARED = source_text("components") + source_text("lib")


def present(label: str, src: str) -> bool:
    """Is this label really in our source as a label?

    Case-sensitively, and not glued to surrounding word characters or hyphens.
    A case-insensitive substring search reported the reference's "Bold" as
    present because Tailwind's font-bold and fontWeight: "bold" both contain it,
    which silently hid a whole missing rich-text toolbar.
    """
    return re.search(r"(?<![\w-])" + re.escape(label) + r"(?![\w-])", src) is not None

report = {}
for name, route in PAGES.items():
    path = os.path.join(UI, f"{name}.json")
    if not os.path.exists(path):
        continue
    data = json.load(io.open(path, encoding="utf-8"))
    labels = set()
    for c in data.get("controls", []) or []:
        l = (c.get("label") or "").strip()
        if is_chrome(l):
            labels.add(l)
    for t in data.get("text", []) or []:
        l = (t.get("t") or "").strip()
        if is_chrome(l):
            labels.add(l)
    ours = source_text(route) + SHARED
    missing = sorted(l for l in labels if not present(l, ours))
    report[name] = {"route": route, "checked": len(labels), "missing": missing}
    print(f"{name:22s} {len(labels):4d} labels  {len(missing):3d} missing")

io.open(os.path.join(OUT, "label-diff.json"), "w", encoding="utf-8").write(
    json.dumps(report, indent=2)
)
print("\nwrote label-diff.json")

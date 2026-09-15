import json, os, sys
from collections import Counter
REF="scripts/creatorcore/out/parity/2026-09-14T14-31-27/desktop-1600"
OUR=sys.argv[1]
PAIRS=[("campaigns","nav-campaigns"),("activations","nav-activations"),("calendar","nav-calendar"),
       ("clients","nav-clients"),("creators","nav-creators"),("lists","nav-lists"),("payouts","nav-payouts"),
       ("requests","nav-requests"),("recipients","nav-recipients"),("connections","nav-connections"),
       ("discovery","nav-discovery"),("fan-pages","nav-fan-pages"),
       ("campaign-busy-overview","campaign-overview"),("campaign-busy-posts","campaign-posts"),
       ("campaign-busy-creators","campaign-creators"),("campaign-busy-drafts","campaign-drafts"),
       ("campaign-busy-analytics","campaign-analytics"),("campaign-busy-financials","campaign-financials"),
       ("campaign-busy-documents","campaign-documents"),
       ("settings-general","settings-general"),("settings-team","settings-team"),
       ("settings-notifications","settings-notifications"),("settings-integrations","settings-integrations")]
def uni(p):
    c=json.load(open(p)); m={}; cnt=Counter()
    for i in c["items"]:
        if i["kind"] not in ("text","control") or i["x"]<255: continue
        k=i["kind"]+"|"+i["key"]; cnt[k]+=1; m.setdefault(k,[]).append(i)
    return {k:v[0] for k,v in m.items() if cnt[k]==1}
tot_m=tot_s=0; rows=[]
for tid,oid in PAIRS:
    pt=os.path.join(REF,tid+".census.json"); po=os.path.join(OUR,oid+".census.json")
    if not(os.path.exists(pt) and os.path.exists(po)): continue
    t=uni(pt); o=uni(po); moved=shared=0
    for k,ti in t.items():
        ui=o.get(k)
        if not ui: continue
        shared+=1
        w=max(abs(ui["x"]-ti["x"]),abs(ui["y"]-ti["y"]),abs(ui["w"]-ti["w"]),abs(ui["h"]-ti["h"]))
        if w>4: moved+=1
    tot_m+=moved; tot_s+=shared; rows.append((oid,moved,shared))
for oid,m,sh in rows: print(f"{oid:24} {m:>3}/{sh:<4}")
print(f"TOTAL {tot_m}/{tot_s} = {100*tot_m/tot_s:.0f}% moved")

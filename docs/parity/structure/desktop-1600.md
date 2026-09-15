# Structural diff — desktop-1600

Reference `scripts/creatorcore/out/parity/2026-09-14T02-14-34` · ours `scripts/creatorcore/out/parity-ours/2026-09-14T02-22-05`

**2765 structural differences** across 25 surfaces 
(high 949 / med 1467 / low 349).

| kind | n | means |
|---|---|---|
| MISSING | 532 | they render it, we do not |
| EXTRA | 842 | we render it, they do not |
| ORDER | 397 | both render it, in a different sequence |
| MOVED | 472 | same node, >4px from the landmark origin |
| RESIZED | 315 | same node, >4px box difference |
| RESTYLED | 207 | same node, different paint |

## Highest severity, by surface

### campaigns — 69

- `MOVED` **box ""** — offset by -126.6, -20px relative to the landmark origin _(shell.rail)_
- `RESIZED` **box ""** — 240×56 vs 2×35 _(shell.rail)_
- `RESIZED` **text "Campaigns & Reporting"** — 220×18.8 vs 174.5×18.8 _(shell.rail)_
- `ORDER` **button ""** — sequence 2 in ours, 3 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +46, -92.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +50, -88.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Campaigns"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Campaigns"** — 88×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 31 in ours, 6 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +144, +761.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Activations"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Activations"** — 86.7×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 32 in ours, 9 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +186, +713.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Calendar"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Calendar"** — 70.5×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 33 in ours, 12 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by -20, +654.2px relative to the landmark origin _(shell.rail)_
- `RESIZED` **button ""** — 160×56 vs 18×18 _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Clients"** — offset by +0, +130px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Clients"** — 52.4×20 vs 172×20 _(shell.rail)_
- `MISSING` **button ""** — present in the reference at 20,302.3 (18×18); nothing in ours pairs with it _(shell.rail)_

### payouts — 68

- `MOVED` **box ""** — offset by -126.6, -20px relative to the landmark origin _(shell.rail)_
- `RESIZED` **box ""** — 240×56 vs 2×35 _(shell.rail)_
- `RESIZED` **text "Campaigns & Reporting"** — 220×18.8 vs 174.5×18.8 _(shell.rail)_
- `ORDER` **button ""** — sequence 2 in ours, 3 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +46, -92.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +50, -88.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Campaigns"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Campaigns"** — 88×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 31 in ours, 6 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +144, +761.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Activations"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Activations"** — 86.7×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 32 in ours, 9 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +186, +713.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Calendar"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Calendar"** — 70.5×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 33 in ours, 12 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by -20, +654.2px relative to the landmark origin _(shell.rail)_
- `RESIZED` **button ""** — 160×56 vs 18×18 _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Clients"** — offset by +0, +130px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Clients"** — 52.4×20 vs 172×20 _(shell.rail)_
- `MISSING` **button ""** — present in the reference at 20,302.3 (18×18); nothing in ours pairs with it _(shell.rail)_

### clients — 66

- `MOVED` **box ""** — offset by -126.6, -20px relative to the landmark origin _(shell.rail)_
- `RESIZED` **box ""** — 240×56 vs 2×35 _(shell.rail)_
- `RESIZED` **text "Campaigns & Reporting"** — 220×18.8 vs 174.5×18.8 _(shell.rail)_
- `ORDER` **button ""** — sequence 2 in ours, 3 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +46, -92.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +50, -88.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Campaigns"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Campaigns"** — 88×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 31 in ours, 6 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +144, +761.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Activations"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Activations"** — 86.7×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 32 in ours, 9 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +186, +713.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Calendar"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Calendar"** — 70.5×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 33 in ours, 12 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by -20, +654.2px relative to the landmark origin _(shell.rail)_
- `RESIZED` **button ""** — 160×56 vs 18×18 _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Clients"** — offset by +0, +130px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Clients"** — 52.4×20 vs 172×20 _(shell.rail)_
- `MISSING` **button ""** — present in the reference at 20,302.3 (18×18); nothing in ours pairs with it _(shell.rail)_

### creators — 66

- `MOVED` **box ""** — offset by -126.6, -20px relative to the landmark origin _(shell.rail)_
- `RESIZED` **box ""** — 240×56 vs 2×35 _(shell.rail)_
- `RESIZED` **text "Campaigns & Reporting"** — 220×18.8 vs 174.5×18.8 _(shell.rail)_
- `ORDER` **button ""** — sequence 2 in ours, 3 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +46, -92.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +50, -88.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Campaigns"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Campaigns"** — 88×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 31 in ours, 6 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +144, +761.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Activations"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Activations"** — 86.7×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 32 in ours, 9 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +186, +713.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Calendar"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Calendar"** — 70.5×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 33 in ours, 12 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by -20, +654.2px relative to the landmark origin _(shell.rail)_
- `RESIZED` **button ""** — 160×56 vs 18×18 _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Clients"** — offset by +0, +130px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Clients"** — 52.4×20 vs 172×20 _(shell.rail)_
- `MISSING` **button ""** — present in the reference at 20,302.3 (18×18); nothing in ours pairs with it _(shell.rail)_

### lists — 66

- `MOVED` **box ""** — offset by -126.6, -20px relative to the landmark origin _(shell.rail)_
- `RESIZED` **box ""** — 240×56 vs 2×35 _(shell.rail)_
- `RESIZED` **text "Campaigns & Reporting"** — 220×18.8 vs 174.5×18.8 _(shell.rail)_
- `ORDER` **button ""** — sequence 2 in ours, 3 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +46, -92.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +50, -88.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Campaigns"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Campaigns"** — 88×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 31 in ours, 6 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +144, +761.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Activations"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Activations"** — 86.7×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 32 in ours, 9 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +186, +713.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Calendar"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Calendar"** — 70.5×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 33 in ours, 12 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by -20, +654.2px relative to the landmark origin _(shell.rail)_
- `RESIZED` **button ""** — 160×56 vs 18×18 _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Clients"** — offset by +0, +130px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Clients"** — 52.4×20 vs 172×20 _(shell.rail)_
- `MISSING` **button ""** — present in the reference at 20,302.3 (18×18); nothing in ours pairs with it _(shell.rail)_

### calendar — 65

- `MOVED` **box ""** — offset by -126.6, -20px relative to the landmark origin _(shell.rail)_
- `RESIZED` **box ""** — 240×56 vs 2×35 _(shell.rail)_
- `RESIZED` **text "Campaigns & Reporting"** — 220×18.8 vs 174.5×18.8 _(shell.rail)_
- `ORDER` **button ""** — sequence 2 in ours, 3 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +46, -92.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +50, -88.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Campaigns"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Campaigns"** — 88×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 31 in ours, 6 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +144, +761.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Activations"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Activations"** — 86.7×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 32 in ours, 9 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +186, +713.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Calendar"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Calendar"** — 70.5×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 33 in ours, 12 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by -20, +654.2px relative to the landmark origin _(shell.rail)_
- `RESIZED` **button ""** — 160×56 vs 18×18 _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Clients"** — offset by +0, +130px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Clients"** — 52.4×20 vs 172×20 _(shell.rail)_
- `MISSING` **button ""** — present in the reference at 20,302.3 (18×18); nothing in ours pairs with it _(shell.rail)_

### requests — 65

- `MOVED` **box ""** — offset by -126.6, -20px relative to the landmark origin _(shell.rail)_
- `RESIZED` **box ""** — 240×56 vs 2×35 _(shell.rail)_
- `RESIZED` **text "Campaigns & Reporting"** — 220×18.8 vs 174.5×18.8 _(shell.rail)_
- `ORDER` **button ""** — sequence 2 in ours, 3 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +46, -92.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +50, -88.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Campaigns"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Campaigns"** — 88×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 31 in ours, 6 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +144, +761.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Activations"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Activations"** — 86.7×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 32 in ours, 9 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +186, +713.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Calendar"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Calendar"** — 70.5×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 33 in ours, 12 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by -20, +654.2px relative to the landmark origin _(shell.rail)_
- `RESIZED` **button ""** — 160×56 vs 18×18 _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Clients"** — offset by +0, +130px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Clients"** — 52.4×20 vs 172×20 _(shell.rail)_
- `MISSING` **button ""** — present in the reference at 20,302.3 (18×18); nothing in ours pairs with it _(shell.rail)_

### recipients — 65

- `MOVED` **box ""** — offset by -126.6, -20px relative to the landmark origin _(shell.rail)_
- `RESIZED` **box ""** — 240×56 vs 2×35 _(shell.rail)_
- `RESIZED` **text "Campaigns & Reporting"** — 220×18.8 vs 174.5×18.8 _(shell.rail)_
- `ORDER` **button ""** — sequence 2 in ours, 3 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +46, -92.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +50, -88.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Campaigns"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Campaigns"** — 88×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 31 in ours, 6 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +144, +761.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Activations"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Activations"** — 86.7×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 32 in ours, 9 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +186, +713.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Calendar"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Calendar"** — 70.5×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 33 in ours, 12 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by -20, +654.2px relative to the landmark origin _(shell.rail)_
- `RESIZED` **button ""** — 160×56 vs 18×18 _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Clients"** — offset by +0, +130px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Clients"** — 52.4×20 vs 172×20 _(shell.rail)_
- `MISSING` **button ""** — present in the reference at 20,302.3 (18×18); nothing in ours pairs with it _(shell.rail)_

### connections — 64

- `MOVED` **box ""** — offset by -126.6, -20px relative to the landmark origin _(shell.rail)_
- `RESIZED` **box ""** — 240×56 vs 2×35 _(shell.rail)_
- `RESIZED` **text "Campaigns & Reporting"** — 220×18.8 vs 174.5×18.8 _(shell.rail)_
- `ORDER` **button ""** — sequence 2 in ours, 3 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +46, -92.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +50, -88.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Campaigns"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Campaigns"** — 88×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 31 in ours, 6 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +144, +761.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Activations"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Activations"** — 86.7×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 32 in ours, 9 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +186, +713.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Calendar"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Calendar"** — 70.5×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 33 in ours, 12 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by -20, +654.2px relative to the landmark origin _(shell.rail)_
- `RESIZED` **button ""** — 160×56 vs 18×18 _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Clients"** — offset by +0, +130px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Clients"** — 52.4×20 vs 172×20 _(shell.rail)_
- `MISSING` **button ""** — present in the reference at 20,302.3 (18×18); nothing in ours pairs with it _(shell.rail)_

### activations — 63

- `MOVED` **box ""** — offset by -126.6, -20px relative to the landmark origin _(shell.rail)_
- `RESIZED` **box ""** — 240×56 vs 2×35 _(shell.rail)_
- `RESIZED` **text "Campaigns & Reporting"** — 220×18.8 vs 174.5×18.8 _(shell.rail)_
- `ORDER` **button ""** — sequence 2 in ours, 3 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +46, -92.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +50, -88.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Campaigns"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Campaigns"** — 88×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 31 in ours, 6 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +144, +761.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Activations"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Activations"** — 86.7×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 32 in ours, 9 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +186, +713.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Calendar"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Calendar"** — 70.5×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 33 in ours, 12 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by -20, +654.2px relative to the landmark origin _(shell.rail)_
- `RESIZED` **button ""** — 160×56 vs 18×18 _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Clients"** — offset by +0, +130px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Clients"** — 52.4×20 vs 172×20 _(shell.rail)_
- `MISSING` **button ""** — present in the reference at 20,302.3 (18×18); nothing in ours pairs with it _(shell.rail)_

### fan-pages — 62

- `MOVED` **box ""** — offset by -126.6, -20px relative to the landmark origin _(shell.rail)_
- `RESIZED` **box ""** — 240×56 vs 2×35 _(shell.rail)_
- `RESIZED` **text "Campaigns & Reporting"** — 220×18.8 vs 174.5×18.8 _(shell.rail)_
- `ORDER` **button ""** — sequence 2 in ours, 3 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +46, -92.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +50, -88.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Campaigns"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Campaigns"** — 88×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 31 in ours, 6 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +144, +761.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Activations"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Activations"** — 86.7×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 32 in ours, 9 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +186, +713.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Calendar"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Calendar"** — 70.5×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 33 in ours, 12 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by -20, +654.2px relative to the landmark origin _(shell.rail)_
- `RESIZED` **button ""** — 160×56 vs 18×18 _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Clients"** — offset by +0, +130px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Clients"** — 52.4×20 vs 172×20 _(shell.rail)_
- `MISSING` **button ""** — present in the reference at 20,302.3 (18×18); nothing in ours pairs with it _(shell.rail)_

### discovery — 62

- `MOVED` **box ""** — offset by -126.6, -20px relative to the landmark origin _(shell.rail)_
- `RESIZED` **box ""** — 240×56 vs 2×35 _(shell.rail)_
- `RESIZED` **text "Campaigns & Reporting"** — 220×18.8 vs 174.5×18.8 _(shell.rail)_
- `ORDER` **button ""** — sequence 2 in ours, 3 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +46, -92.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +50, -88.3px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Campaigns"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Campaigns"** — 88×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 31 in ours, 6 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +144, +761.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Activations"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Activations"** — 86.7×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 32 in ours, 9 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by +186, +713.2px relative to the landmark origin _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Calendar"** — offset by +0, +82px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Calendar"** — 70.5×20 vs 172×20 _(shell.rail)_
- `ORDER` **button ""** — sequence 33 in ours, 12 in the reference _(shell.rail)_
- `MOVED` **button ""** — offset by -20, +654.2px relative to the landmark origin _(shell.rail)_
- `RESIZED` **button ""** — 160×56 vs 18×18 _(shell.rail)_
- `MOVED` **icon ""** — offset by +0, -62px relative to the landmark origin _(shell.rail)_
- `MOVED` **text "Clients"** — offset by +0, +130px relative to the landmark origin _(shell.rail)_
- `RESIZED` **text "Clients"** — 52.4×20 vs 172×20 _(shell.rail)_
- `MISSING` **button ""** — present in the reference at 20,302.3 (18×18); nothing in ours pairs with it _(shell.rail)_

### campaign-reference-overview — 20

- `MOVED` **box ""** — offset by -20.8, -120px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **box ""** — 240×56 vs 166.4×50 _(campaign.rail)_
- `MOVED` **text "Overview"** — offset by +17.2, +64px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Overview"** — 73.7×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Creators"** — offset by +17.2, +158px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Creators"** — 66.5×20 vs 146.4×22.5 _(campaign.rail)_
- `RESIZED` **text "Drafts"** — 48.7×20 vs 146.4×22.5 _(campaign.rail)_
- `RESIZED` **text "Posts"** — 41.6×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Analytics"** — offset by +17.2, +104px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Analytics"** — 70.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Financials"** — offset by +17.2, +102px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Financials"** — 78.1×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Documents"** — offset by +17.2, +100px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Documents"** — 87.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Settings"** — offset by +17.2, +98px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Settings"** — 63.5×20 vs 146.4×22.5 _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 66,15.5 (24×24); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 164,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 206,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 0,906 (160×56); the reference has no counterpart _(campaign.rail)_

### campaign-reference-creators — 20

- `MOVED` **text "Overview"** — offset by +17.2, +64px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Overview"** — 73.7×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **box ""** — offset by -20.8, -170px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **box ""** — 240×56 vs 166.4×50 _(campaign.rail)_
- `MOVED` **text "Creators"** — offset by +17.2, +158px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Creators"** — 66.5×20 vs 146.4×22.5 _(campaign.rail)_
- `RESIZED` **text "Drafts"** — 48.7×20 vs 146.4×22.5 _(campaign.rail)_
- `RESIZED` **text "Posts"** — 41.6×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Analytics"** — offset by +17.2, +104px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Analytics"** — 70.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Financials"** — offset by +17.2, +102px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Financials"** — 78.1×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Documents"** — offset by +17.2, +100px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Documents"** — 87.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Settings"** — offset by +17.2, +98px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Settings"** — 63.5×20 vs 146.4×22.5 _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 66,15.5 (24×24); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 164,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 206,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 0,906 (160×56); the reference has no counterpart _(campaign.rail)_

### campaign-reference-drafts — 20

- `MOVED` **text "Overview"** — offset by +17.2, +64px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Overview"** — 73.7×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Creators"** — offset by +17.2, +158px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Creators"** — 66.5×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **box ""** — offset by -20.8, -220px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **box ""** — 240×56 vs 166.4×50 _(campaign.rail)_
- `RESIZED` **text "Drafts"** — 48.7×20 vs 146.4×22.5 _(campaign.rail)_
- `RESIZED` **text "Posts"** — 41.6×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Analytics"** — offset by +17.2, +104px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Analytics"** — 70.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Financials"** — offset by +17.2, +102px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Financials"** — 78.1×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Documents"** — offset by +17.2, +100px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Documents"** — 87.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Settings"** — offset by +17.2, +98px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Settings"** — 63.5×20 vs 146.4×22.5 _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 66,15.5 (24×24); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 164,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 206,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 0,906 (160×56); the reference has no counterpart _(campaign.rail)_

### campaign-reference-posts — 20

- `MOVED` **text "Overview"** — offset by +17.2, +64px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Overview"** — 73.7×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Creators"** — offset by +17.2, +158px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Creators"** — 66.5×20 vs 146.4×22.5 _(campaign.rail)_
- `RESIZED` **text "Drafts"** — 48.7×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **box ""** — offset by -20.8, -270px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **box ""** — 240×56 vs 166.4×50 _(campaign.rail)_
- `RESIZED` **text "Posts"** — 41.6×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Analytics"** — offset by +17.2, +104px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Analytics"** — 70.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Financials"** — offset by +17.2, +102px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Financials"** — 78.1×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Documents"** — offset by +17.2, +100px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Documents"** — 87.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Settings"** — offset by +17.2, +98px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Settings"** — 63.5×20 vs 146.4×22.5 _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 66,15.5 (24×24); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 164,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 206,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 0,906 (160×56); the reference has no counterpart _(campaign.rail)_

### campaign-reference-analytics — 20

- `MOVED` **text "Overview"** — offset by +17.2, +64px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Overview"** — 73.7×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Creators"** — offset by +17.2, +158px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Creators"** — 66.5×20 vs 146.4×22.5 _(campaign.rail)_
- `RESIZED` **text "Drafts"** — 48.7×20 vs 146.4×22.5 _(campaign.rail)_
- `RESIZED` **text "Posts"** — 41.6×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **box ""** — offset by -20.8, -320px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **box ""** — 240×56 vs 166.4×50 _(campaign.rail)_
- `MOVED` **text "Analytics"** — offset by +17.2, +104px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Analytics"** — 70.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Financials"** — offset by +17.2, +102px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Financials"** — 78.1×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Documents"** — offset by +17.2, +100px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Documents"** — 87.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Settings"** — offset by +17.2, +98px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Settings"** — 63.5×20 vs 146.4×22.5 _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 66,15.5 (24×24); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 164,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 206,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 0,906 (160×56); the reference has no counterpart _(campaign.rail)_

### campaign-reference-financials — 20

- `MOVED` **text "Overview"** — offset by +17.2, +64px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Overview"** — 73.7×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Creators"** — offset by +17.2, +158px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Creators"** — 66.5×20 vs 146.4×22.5 _(campaign.rail)_
- `RESIZED` **text "Drafts"** — 48.7×20 vs 146.4×22.5 _(campaign.rail)_
- `RESIZED` **text "Posts"** — 41.6×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Analytics"** — offset by +17.2, +104px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Analytics"** — 70.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **box ""** — offset by -20.8, -370px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **box ""** — 240×56 vs 166.4×50 _(campaign.rail)_
- `MOVED` **text "Financials"** — offset by +17.2, +102px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Financials"** — 78.1×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Documents"** — offset by +17.2, +100px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Documents"** — 87.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Settings"** — offset by +17.2, +98px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Settings"** — 63.5×20 vs 146.4×22.5 _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 66,15.5 (24×24); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 164,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 206,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 0,906 (160×56); the reference has no counterpart _(campaign.rail)_

### campaign-reference-documents — 20

- `MOVED` **text "Overview"** — offset by +17.2, +64px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Overview"** — 73.7×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Creators"** — offset by +17.2, +158px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Creators"** — 66.5×20 vs 146.4×22.5 _(campaign.rail)_
- `RESIZED` **text "Drafts"** — 48.7×20 vs 146.4×22.5 _(campaign.rail)_
- `RESIZED` **text "Posts"** — 41.6×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Analytics"** — offset by +17.2, +104px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Analytics"** — 70.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Financials"** — offset by +17.2, +102px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Financials"** — 78.1×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **box ""** — offset by -20.8, -420px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **box ""** — 240×56 vs 166.4×50 _(campaign.rail)_
- `MOVED` **text "Documents"** — offset by +17.2, +100px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Documents"** — 87.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Settings"** — offset by +17.2, +98px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Settings"** — 63.5×20 vs 146.4×22.5 _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 66,15.5 (24×24); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 164,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 206,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 0,906 (160×56); the reference has no counterpart _(campaign.rail)_

### campaign-reference-settings — 20

- `MOVED` **text "Overview"** — offset by +17.2, +64px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Overview"** — 73.7×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Creators"** — offset by +17.2, +158px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Creators"** — 66.5×20 vs 146.4×22.5 _(campaign.rail)_
- `RESIZED` **text "Drafts"** — 48.7×20 vs 146.4×22.5 _(campaign.rail)_
- `RESIZED` **text "Posts"** — 41.6×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Analytics"** — offset by +17.2, +104px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Analytics"** — 70.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Financials"** — offset by +17.2, +102px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Financials"** — 78.1×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **text "Documents"** — offset by +17.2, +100px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Documents"** — 87.8×20 vs 146.4×22.5 _(campaign.rail)_
- `MOVED` **box ""** — offset by -20.8, -470px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **box ""** — 240×56 vs 166.4×50 _(campaign.rail)_
- `MOVED` **text "Settings"** — offset by +17.2, +98px relative to the landmark origin _(campaign.rail)_
- `RESIZED` **text "Settings"** — 63.5×20 vs 146.4×22.5 _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 66,15.5 (24×24); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 164,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 206,917 (34×34); the reference has no counterpart _(campaign.rail)_
- `EXTRA` **button ""** — we render it at 0,906 (160×56); the reference has no counterpart _(campaign.rail)_

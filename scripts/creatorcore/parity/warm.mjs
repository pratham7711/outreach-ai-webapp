import fs from "node:fs";
import { encode } from "next-auth/jwt";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n")
  .filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^"(.*)"$/,"$1")];}));
const COOKIE="authjs.session-token";
const token = await encode({ token:{ sub:"cmnbxspfv00016vfdz6yuds55", id:"cmnbxspfv00016vfdz6yuds55",
  email:"admin@demo.com", name:"Admin", orgId:"cmnbxsoos00006vfd7jhdvusb", role:"OWNER" },
  secret: env.NEXTAUTH_SECRET, salt: COOKIE });

const NAV=["dashboard","campaigns","creators","clients","analytics","reports","calendar","deadlines","inbox","discovery","lists","media-kits","payouts","requests","activations","connections","fan-pages","financial-reports","plans","recipients","audit-log"];
const SETTINGS=["general","team","billing","notifications","integrations","api-keys","profile","ingestion"];
const paths=[...NAV.map(n=>"/"+n), ...SETTINGS.map(t=>"/settings/"+t)];

// the campaign fixture, discovered the way capture-ours does
const html = await (await fetch("http://localhost:3009/campaigns",{headers:{cookie:`${COOKIE}=${token}`}})).text();
const m = [...html.matchAll(/href="\/campaigns\/([^"\/?]+)"/g)].map(x=>x[1]).filter(x=>x!=="self-serve");
const camp = m[0];
if (camp) for (const s of ["performance","overview","drafts","posts","creators","reviews","analytics","financials","documents","edit"])
  paths.push(`/campaigns/${camp}?section=${s}`);
console.log("campaign fixture:", camp ?? "NONE");

let bad=0;
for (const p of paths) {
  const t0=Date.now();
  let status=0, body="";
  for (let a=0;a<3;a++){
    try{ const r=await fetch("http://localhost:3009"+p,{headers:{cookie:`${COOKIE}=${token}`}});
      status=r.status; body=await r.text();
      if (status===200 && !body.includes("build-manifest.json") && !body.includes("Runtime Error")) break;
    }catch(e){ status=-1; body=String(e); }
    await new Promise(r=>setTimeout(r,800));
  }
  const ok = status===200 && !body.includes("build-manifest.json");
  if(!ok) bad++;
  console.log((ok?"  ok  ":"  BAD "), String(status).padStart(3), String(Date.now()-t0).padStart(6)+"ms", p);
}
console.log(bad===0 ? "\nall routes warm" : `\n${bad} routes still failing`);

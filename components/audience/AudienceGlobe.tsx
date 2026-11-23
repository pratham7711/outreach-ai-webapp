"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * A globe with every country shaded by its share of an audience, drawn on a
 * canvas with no map library: an orthographic projection of Natural Earth's
 * 1:110m country outlines (public domain), served from /geo/countries-110m.json
 * as [{ c: ISO 3166-1 alpha-2, n: name, g: polygons of [lon, lat] rings }].
 *
 * It turns slowly until someone drags it, faces the largest country first,
 * stops turning for anyone who prefers reduced motion, and pauses while it is
 * off screen. The shares are also spelled out beside it (the list the caller
 * renders), so the colours only repeat what the text says.
 */

type Ring = Array<[number, number]>;
type Country = { c: string | null; n: string; g: Ring[][]; box: [number, number, number, number] };
type Vec = [number, number, number];

let geoPromise: Promise<Country[]> | null = null;

/** Edges longer than this many degrees are split, so long straight borders bend with the sphere. */
const MAX_STEP = 2;

function densify(ring: Ring): Ring {
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    out.push([x0, y0]);
    if (i === ring.length - 1) break;
    const steps = Math.floor(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / MAX_STEP);
    for (let s = 1; s < steps; s++) out.push([x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps]);
  }
  return out;
}

function loadCountries(): Promise<Country[]> {
  geoPromise ??= fetch("/geo/countries-110m.json")
    .then((r) => {
      if (!r.ok) throw new Error(`geo ${r.status}`);
      return r.json() as Promise<Array<{ c: string | null; n: string; g: Ring[][] }>>;
    })
    .then((rows) =>
      rows.map((row) => {
        let minX = 180, minY = 90, maxX = -180, maxY = -90;
        const g = row.g.map((poly) =>
          poly.map((ring) => {
            for (const [x, y] of ring) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
            return densify(ring);
          }),
        );
        return { c: row.c, n: row.n, g, box: [minX, minY, maxX, maxY] as [number, number, number, number] };
      }),
    )
    .catch((e) => {
      geoPromise = null;
      throw e;
    });
  return geoPromise;
}

const RAD = Math.PI / 180;

/** [lon, lat] to a unit vector, turned so the view centre (lon0, lat0) faces +x. */
function rotate(lon: number, lat: number, lon0: number, lat0: number): Vec {
  const l = (lon - lon0) * RAD;
  const p = lat * RAD;
  const x = Math.cos(p) * Math.cos(l);
  const y = Math.cos(p) * Math.sin(l);
  const z = Math.sin(p);
  const c = Math.cos(lat0 * RAD);
  const s = Math.sin(lat0 * RAD);
  return [x * c + z * s, y, -x * s + z * c];
}

/** The inverse: a point on the visible disc back to [lon, lat]. */
function unrotate(y: number, z: number, lon0: number, lat0: number): [number, number] | null {
  const r2 = y * y + z * z;
  if (r2 > 1) return null;
  const x = Math.sqrt(1 - r2);
  const c = Math.cos(lat0 * RAD);
  const s = Math.sin(lat0 * RAD);
  const X = x * c - z * s;
  const Z = x * s + z * c;
  const lat = Math.asin(Math.max(-1, Math.min(1, Z))) / RAD;
  let lon = Math.atan2(y, X) / RAD + lon0;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return [lon, lat];
}

/** The part of a ring on the near side (x >= 0), with horizon crossings added. */
function clipRing(points: Vec[]): Array<{ v: Vec; horizon: boolean }> {
  const out: Array<{ v: Vec; horizon: boolean }> = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const aIn = a[0] >= 0;
    const bIn = b[0] >= 0;
    if (aIn && bIn) out.push({ v: b, horizon: false });
    else if (aIn !== bIn) {
      const t = a[0] / (a[0] - b[0]);
      const y = a[1] + t * (b[1] - a[1]);
      const z = a[2] + t * (b[2] - a[2]);
      const len = Math.hypot(y, z) || 1;
      out.push({ v: [0, y / len, z / len], horizon: true });
      if (bIn) out.push({ v: b, horizon: false });
    }
  }
  return out;
}

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function countryAt(countries: Country[], lon: number, lat: number): Country | null {
  for (const c of countries) {
    const [x0, y0, x1, y1] = c.box;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    for (const poly of c.g) {
      if (!inRing(lon, lat, poly[0])) continue;
      if (poly.slice(1).some((hole) => inRing(lon, lat, hole))) continue;
      return c;
    }
  }
  return null;
}

function centroid(c: Country): [number, number] {
  let best = c.g[0]?.[0] ?? [];
  for (const poly of c.g) if (poly[0].length > best.length) best = poly[0];
  if (!best.length) return [0, 20];
  const lon = best.reduce((a, p) => a + p[0], 0) / best.length;
  const lat = best.reduce((a, p) => a + p[1], 0) / best.length;
  return [lon, lat];
}

function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

const formatShare = (share: number) => `${share >= 0.1 ? Math.round(share * 100) : (share * 100).toFixed(1).replace(/\.0$/, "")}%`;

export type GlobeShare = { key: string; share: number };

export function AudienceGlobe({
  shares,
  label,
  size = 280,
}: {
  /** ISO 3166-1 alpha-2 code to share of the audience (0..1). */
  shares: GlobeShare[];
  /** What the shading means, for the accessible name: "Followers by country". */
  label: string;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [countries, setCountries] = useState<Country[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<{ name: string; share: number | null; x: number; y: number } | null>(null);
  const view = useRef({ lon0: 0, lat0: 20, dragging: false, touched: false, visible: true, lastX: 0, lastY: 0 });

  const byCode = useMemo(() => new Map(shares.map((s) => [s.key.toUpperCase(), s.share])), [shares]);
  const max = useMemo(() => Math.max(0.0001, ...shares.map((s) => s.share)), [shares]);

  useEffect(() => {
    let alive = true;
    loadCountries()
      .then((c) => alive && setCountries(c))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  /* Face the largest country first. */
  useEffect(() => {
    if (!countries || shares.length === 0) return;
    const topKey = [...shares].sort((a, b) => b.share - a.share)[0].key.toUpperCase();
    const top = countries.find((c) => c.c === topKey);
    if (!top) return;
    const [lon, lat] = centroid(top);
    view.current.lon0 = lon;
    view.current.lat0 = Math.max(-45, Math.min(45, lat * 0.8));
  }, [countries, shares]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !countries) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colors = {
      ocean: cssVar(canvas, "--cc-hover-bg", "#f1f2f6"),
      land: cssVar(canvas, "--cc-border", "#e4e6f0"),
      edge: cssVar(canvas, "--cc-card", "#ffffff"),
      rim: cssVar(canvas, "--cc-border", "#e4e6f0"),
      fill: cssVar(canvas, "--cc-primary", "#5b5bd6"),
    };
    const R = size / 2 - 2;
    const cx = size / 2;
    const cy = size / 2;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const draw = () => {
      const { lon0, lat0 } = view.current;
      ctx.clearRect(0, 0, size, size);
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = colors.ocean;
      ctx.fill();

      for (const country of countries) {
        const share = country.c ? byCode.get(country.c) : undefined;
        ctx.beginPath();
        let any = false;
        for (const poly of country.g) {
          for (const ring of poly) {
            const clipped = clipRing(ring.map(([lon, lat]) => rotate(lon, lat, lon0, lat0)));
            if (clipped.length < 3) continue;
            any = true;
            clipped.forEach((p, i) => {
              const x = cx + R * p.v[1];
              const y = cy - R * p.v[2];
              const prev = clipped[(i - 1 + clipped.length) % clipped.length];
              if (i === 0) ctx.moveTo(x, y);
              else if (p.horizon && prev.horizon) {
                /* Two horizon points in a row: follow the rim, the short way. */
                const a0 = Math.atan2(-prev.v[2], prev.v[1]);
                let a1 = Math.atan2(-p.v[2], p.v[1]);
                let d = a1 - a0;
                if (d > Math.PI) d -= Math.PI * 2;
                if (d < -Math.PI) d += Math.PI * 2;
                a1 = a0 + d;
                ctx.arc(cx, cy, R, a0, a1, d < 0);
              } else ctx.lineTo(x, y);
            });
            ctx.closePath();
          }
        }
        if (!any) continue;
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.land;
        ctx.fill("evenodd");
        if (share && share > 0) {
          ctx.globalAlpha = 0.18 + 0.82 * Math.pow(share / max, 0.55);
          ctx.fillStyle = colors.fill;
          ctx.fill("evenodd");
          ctx.globalAlpha = 1;
        }
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = colors.edge;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.rim;
      ctx.stroke();
    };

    let frame = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const v = view.current;
      if (!v.dragging && !v.touched && v.visible && !reduce) {
        v.lon0 += ((t - last) / 1000) * 6;
        draw();
      }
      last = t;
      frame = requestAnimationFrame(tick);
    };
    draw();
    frame = requestAnimationFrame(tick);

    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([e]) => {
          view.current.visible = e.isIntersecting;
        })
      : null;
    io?.observe(canvas);

    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * size, y: ((e.clientY - r.top) / r.height) * size };
    };
    const onDown = (e: PointerEvent) => {
      view.current.dragging = true;
      view.current.touched = true;
      view.current.lastX = e.clientX;
      view.current.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const v = view.current;
      if (v.dragging) {
        v.lon0 -= (e.clientX - v.lastX) * 0.45;
        v.lat0 = Math.max(-70, Math.min(70, v.lat0 + (e.clientY - v.lastY) * 0.45));
        v.lastX = e.clientX;
        v.lastY = e.clientY;
        draw();
        setHover(null);
        return;
      }
      const { x, y } = local(e);
      const at = unrotate((x - cx) / R, -(y - cy) / R, v.lon0, v.lat0);
      const country = at ? countryAt(countries, at[0], at[1]) : null;
      setHover(country ? { name: country.n, share: country.c ? byCode.get(country.c) ?? null : null, x, y } : null);
    };
    const onUp = (e: PointerEvent) => {
      view.current.dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const onLeave = () => setHover(null);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      io?.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [countries, byCode, max, size]);

  const top = [...shares].sort((a, b) => b.share - a.share).slice(0, 5);
  const regionName = (code: string) => {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const ariaLabel = `${label}: ${top.map((s) => `${regionName(s.key)} ${formatShare(s.share)}`).join(", ")}`;

  return (
    <div className="cc-audience-globe" style={{ position: "relative", width: size, maxWidth: "100%", aspectRatio: "1 / 1" }}>
      {failed ? (
        <div role="img" aria-label={ariaLabel} style={{ width: "100%", height: "100%", borderRadius: "50%", background: "var(--cc-hover-bg)" }} />
      ) : (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={ariaLabel}
          data-testid="audience-globe"
          style={{ width: "100%", height: "100%", cursor: "grab", touchAction: "none", display: "block" }}
        />
      )}
      {hover && (
        <div
          role="presentation"
          style={{
            position: "absolute",
            left: Math.min(Math.max(hover.x, 8), size - 8),
            top: hover.y,
            transform: "translate(-50%, calc(-100% - 10px))",
            pointerEvents: "none",
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: 8,
            padding: "6px 9px",
            fontSize: 12,
            color: "var(--cc-text)",
            whiteSpace: "nowrap",
            boxShadow: "var(--cc-shadow-sm, 0 2px 8px rgba(0,0,0,0.08))",
          }}
        >
          {hover.name}
          <strong style={{ marginLeft: 6, fontVariantNumeric: "tabular-nums" }}>
            {hover.share === null ? "—" : formatShare(hover.share)}
          </strong>
        </div>
      )}
    </div>
  );
}

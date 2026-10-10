import { imgSrc, shareImgSrc } from "@/lib/postMedia";

/**
 * A screenshot of what the person is looking at, taken in the browser with no
 * permission prompt: the page is redrawn from its own DOM (modern-screenshot,
 * loaded only when Feedback is pressed), at the size of the window, with each
 * scrolled pane drawn at its scroll position -- the dashboard scrolls inside
 * <main>, not the window.
 *
 * Images from another site cannot be read back into a picture unless that site
 * allows it, which the platform CDNs do not. Those that our own image proxy
 * serves are fetched through it -- /api/img when signed in, the link's own
 * proxy on a share page -- and anything else is drawn as a grey box rather than
 * failing the whole screenshot. Embedded players (iframes) come out blank.
 */

const MAX_WIDTH_PX = 2000;
const QUALITY = 0.8;
/* modern-screenshot waits this long for every <img> on the page to finish
   loading before it starts, and a lazy image below the fold never does: at 8 s
   a share report took 10.2 s to capture, all of it waiting. Each image is
   fetched again for the copy anyway, so a short wait loses nothing visible. */
const TIMEOUT_MS = 3000;
const PROXY_FETCH_TIMEOUT_MS = 4000;
/* Keeps the upload well under the server's 3 MB cap (lib/feedback/submission). */
const MAX_DATA_URL_CHARS = 3_500_000;
const GREY_BOX =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#d9dbe6"/></svg>');

export type Capture = { dataUrl: string } | { error: string };

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function proxiedAddress(url: string, shareToken?: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, location.href);
  } catch {
    return null;
  }
  if (parsed.origin === location.origin || parsed.protocol === "data:" || parsed.protocol === "blob:") return null;
  const raw = parsed.toString();
  const proxied = shareToken ? shareImgSrc(shareToken, raw, 512) : imgSrc(raw, 512);
  return proxied && proxied !== raw ? proxied : null;
}

export async function capturePage(options: { exclude: (node: Node) => boolean; shareToken?: string }): Promise<Capture> {
  try {
    const { domToJpeg } = await import("modern-screenshot");
    const width = window.innerWidth;
    const height = window.innerHeight;
    const background = getComputedStyle(document.body).backgroundColor || "#ffffff";

    const shoot = (scale: number, quality: number) =>
      domToJpeg(document.documentElement, {
        width,
        height,
        scale,
        quality,
        backgroundColor: background,
        timeout: TIMEOUT_MS,
        filter: (node) => !options.exclude(node),
        features: { restoreScrollPosition: true },
        fetch: { placeholderImage: GREY_BOX },
        fetchFn: async (url) => {
          const proxied = proxiedAddress(url, options.shareToken);
          if (!proxied) return false;
          try {
            const res = await fetch(proxied, {
              credentials: "same-origin",
              signal: AbortSignal.timeout(PROXY_FETCH_TIMEOUT_MS),
            });
            if (!res.ok) return GREY_BOX;
            return await blobToDataUrl(await res.blob());
          } catch {
            return GREY_BOX;
          }
        },
      });

    /* Start the lazy images below the fold now rather than letting the capture
       sit out its wait for them: they are fetched for the copy either way. */
    for (const img of Array.from(document.querySelectorAll<HTMLImageElement>('img[loading="lazy"]'))) {
      if (!img.complete) img.loading = "eager";
    }

    const scale = Math.max(0.5, Math.min(window.devicePixelRatio || 1, MAX_WIDTH_PX / width, 2));
    let dataUrl = await shoot(scale, QUALITY);
    if (dataUrl.length > MAX_DATA_URL_CHARS) dataUrl = await shoot(Math.min(1, scale), 0.6);
    if (dataUrl.length > MAX_DATA_URL_CHARS) return { error: "screenshot too large to send" };
    return { dataUrl };
  } catch (err) {
    return { error: (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300) };
  }
}

/**
 * Page capture. These functions run INSIDE the web page via chrome.scripting.executeScript, which
 * serializes the function source, so each one must be self-contained: no imports, no outer helpers.
 * They're also unit-tested directly (test/capture.test.ts) against synthetic markup.
 */

export interface Capture {
  kind: "image" | "video" | "page";
  url: string;
  pageUrl: string;
  title: string;
  imageUrl?: string;
  width?: number;
  height?: number;
  note?: string;
  assumeVideo?: boolean;
  site: "pinterest" | "shotdeck" | "vimeo" | "generic";
}

/** What "Save this page" should save, with site-aware rules for Pinterest, ShotDeck and Vimeo. */
export function capturePage(): Capture {
  const meta = (name: string) =>
    document.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`)?.content?.trim() || undefined;
  const abs = (u: string | null | undefined) => {
    if (!u) return undefined;
    try {
      return new URL(u, location.href).toString();
    } catch {
      return undefined;
    }
  };
  const largestFromSrcset = (img: HTMLImageElement) => {
    let best: { url: string; w: number } | null = null;
    for (const part of (img.getAttribute("srcset") ?? "").split(",")) {
      const [u, d] = part.trim().split(/\s+/);
      const w = d?.endsWith("w") ? Number(d.slice(0, -1)) : d?.endsWith("x") ? Number(d.slice(0, -1)) * 1000 : 0;
      if (u && (!best || w > best.w)) best = { url: u, w };
    }
    return best?.url;
  };
  const pinOriginal = (u: string) => u.replace(/^(https?:\/\/i\.pinimg\.com)\/(?:\d+x\d*|\d+x)\//, "$1/originals/");
  const host = location.hostname.replace(/^www\./, "");
  const pageUrl = location.href;
  const title = meta("og:title") || document.title || host;

  // Vimeo: the video itself (imported through the Vimeo adapter when it's enabled).
  if (/(^|\.)vimeo\.com$/.test(host) && /\/(\d{5,12})(?:\/|$)/.test(location.pathname)) {
    const canonical = abs(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href) ?? pageUrl.split("?")[0]!;
    return { kind: "video", url: canonical, pageUrl, title, imageUrl: meta("og:image"), site: "vimeo" };
  }

  // Pinterest pin: the full-resolution original of the pin image, not the grid thumbnail.
  if (/(^|\.)pinterest\.[a-z.]+$/.test(host) && location.pathname.includes("/pin/")) {
    const imgs = [...document.querySelectorAll<HTMLImageElement>('img[src*="pinimg.com"]')];
    const main = imgs.sort((a, b) => (b.naturalWidth || b.width) * (b.naturalHeight || b.height) - (a.naturalWidth || a.width) * (a.naturalHeight || a.height))[0];
    const src = main ? largestFromSrcset(main) || main.currentSrc || main.src : meta("og:image");
    if (src) return { kind: "image", url: pinOriginal(abs(src)!), pageUrl, title: meta("og:description") || title, site: "pinterest" };
  }

  // ShotDeck still: the full-size frame plus its metadata (film, DP, …) as a note.
  if (/(^|\.)shotdeck\.com$/.test(host)) {
    const full =
      document.querySelector<HTMLElement>("[data-full-src]")?.getAttribute("data-full-src") ||
      document.querySelector<HTMLAnchorElement>("a[download][href]")?.getAttribute("href") ||
      document.querySelector<HTMLImageElement>("img.full-image, .still-modal img, .shot-image img")?.src;
    const pairs: string[] = [];
    document.querySelectorAll("dl").forEach((dl) => {
      const dts = dl.querySelectorAll("dt");
      dts.forEach((dt) => {
        const dd = dt.nextElementSibling;
        if (dd?.tagName === "DD" && dt.textContent && dd.textContent) pairs.push(`${dt.textContent.trim()}: ${dd.textContent.trim()}`);
      });
    });
    if (full) return { kind: "image", url: abs(full)!, pageUrl, title, note: pairs.slice(0, 12).join(" · ") || undefined, site: "shotdeck" };
  }

  // Generic: an og:video file if the page has one, otherwise the page itself with its preview image.
  const ogVideo = meta("og:video:secure_url") || meta("og:video:url") || meta("og:video");
  const ogVideoType = meta("og:video:type") ?? "";
  if (ogVideo && (/video\/(mp4|quicktime|webm)/.test(ogVideoType) || /\.(mp4|mov|webm)(\?|$)/i.test(ogVideo)))
    return { kind: "video", url: abs(ogVideo)!, pageUrl, title, imageUrl: meta("og:image"), assumeVideo: true, site: "generic" };
  return { kind: "page", url: pageUrl, pageUrl, title, imageUrl: abs(meta("og:image")), site: "generic" };
}

/** For a right-clicked image: the best version of it on this page (srcset, data-full, Pinterest originals). */
export function resolveImage(srcUrl: string): { url: string; width?: number; height?: number } {
  const abs = (u: string | null | undefined) => {
    if (!u) return undefined;
    try {
      return new URL(u, location.href).toString();
    } catch {
      return undefined;
    }
  };
  const img = [...document.querySelectorAll("img")].find((i) => i.currentSrc === srcUrl || i.src === srcUrl || abs(i.getAttribute("src")) === srcUrl);
  let url = srcUrl;
  if (img) {
    const full = img.getAttribute("data-full-src") || img.getAttribute("data-original") || img.getAttribute("data-zoom-src");
    let best: { url: string; w: number } | null = null;
    for (const part of (img.getAttribute("srcset") ?? "").split(",")) {
      const [u, d] = part.trim().split(/\s+/);
      const w = d?.endsWith("w") ? Number(d.slice(0, -1)) : d?.endsWith("x") ? Number(d.slice(0, -1)) * 1000 : 0;
      if (u && (!best || w > best.w)) best = { url: u, w };
    }
    const link = img.closest("a")?.getAttribute("href");
    url = abs(full) || abs(best?.url) || (link && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(link) ? abs(link)! : srcUrl);
  }
  url = url.replace(/^(https?:\/\/i\.pinimg\.com)\/(?:\d+x\d*|\d+x)\//, "$1/originals/");
  return { url, width: img?.naturalWidth || undefined, height: img?.naturalHeight || undefined };
}

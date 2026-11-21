import { describe, expect, it } from "vitest";
import { capturePage, resolveImage } from "../src/capture";

/**
 * Synthetic markup shaped like each site's pages. Real Pinterest/ShotDeck/Vimeo markup changes
 * often (and ShotDeck needs a subscription), so these pin down our rules, not their HTML.
 */
function load(url: string, html: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
  document.head.innerHTML = "";
  document.body.innerHTML = html;
  const head = /<head>([\s\S]*)<\/head>/.exec(html)?.[1];
  if (head) document.head.innerHTML = head;
}

describe("capturePage", () => {
  it("Pinterest pin → the original-size image, not the thumbnail", () => {
    load(
      "https://www.pinterest.com/pin/123456789/",
      `<head><meta property="og:description" content="Rainy neon street"></head>
       <img src="https://i.pinimg.com/236x/ab/cd/ef/abcdef.jpg" width="236" height="350">
       <img src="https://i.pinimg.com/736x/ab/cd/ef/abcdef.jpg" srcset="https://i.pinimg.com/736x/ab/cd/ef/abcdef.jpg 1x, https://i.pinimg.com/1200x/ab/cd/ef/abcdef.jpg 2x" width="736" height="1100">`,
    );
    expect(capturePage()).toMatchObject({ kind: "image", site: "pinterest", url: "https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg", title: "Rainy neon street" });
  });

  it("ShotDeck still → full-size frame plus metadata note", () => {
    load(
      "https://shotdeck.com/browse/stills#/s/abc123",
      `<head><meta property="og:title" content="In the Mood for Love (2000)"></head>
       <div class="still-modal"><img class="thumb" src="/assets/thumbs/abc123.jpg"><span data-full-src="/assets/images/abc123_full.jpg"></span></div>
       <dl><dt>Director of Photography</dt><dd>Christopher Doyle</dd><dt>Lens</dt><dd>Spherical</dd></dl>`,
    );
    const c = capturePage();
    expect(c).toMatchObject({ kind: "image", site: "shotdeck", url: "https://shotdeck.com/assets/images/abc123_full.jpg", title: "In the Mood for Love (2000)" });
    expect(c.note).toBe("Director of Photography: Christopher Doyle · Lens: Spherical");
  });

  it("Vimeo video page → the canonical video URL (for the Vimeo adapter)", () => {
    load(
      "https://vimeo.com/123456789?share=copy",
      `<head><meta property="og:title" content="Night drive"><meta property="og:image" content="https://i.vimeocdn.com/video/1.jpg"><link rel="canonical" href="https://vimeo.com/123456789"></head>`,
    );
    expect(capturePage()).toMatchObject({ kind: "video", site: "vimeo", url: "https://vimeo.com/123456789", title: "Night drive", imageUrl: "https://i.vimeocdn.com/video/1.jpg" });
  });

  it("generic page with an og:video file → the video", () => {
    load("https://example.com/post", `<head><meta property="og:video" content="https://cdn.example.com/clip.mp4"><meta property="og:video:type" content="video/mp4"><title>Clip</title></head>`);
    expect(capturePage()).toMatchObject({ kind: "video", url: "https://cdn.example.com/clip.mp4", assumeVideo: true });
  });

  it("generic page → the page with its preview image", () => {
    load("https://example.com/article", `<head><title>Lighting notes</title><meta property="og:image" content="/cover.jpg"></head><p>hi</p>`);
    expect(capturePage()).toMatchObject({ kind: "page", url: "https://example.com/article", title: "Lighting notes", imageUrl: "https://example.com/cover.jpg" });
  });
});

describe("resolveImage", () => {
  it("prefers data-full-src, then the largest srcset entry, then a linked image file", () => {
    load("https://example.com/", `<img id="a" src="/s.jpg" data-full-src="/full.jpg"><img id="b" src="/m.jpg" srcset="/m.jpg 640w, /l.jpg 1920w"><a href="/huge.png"><img id="c" src="/t.jpg"></a>`);
    expect(resolveImage("https://example.com/s.jpg").url).toBe("https://example.com/full.jpg");
    expect(resolveImage("https://example.com/m.jpg").url).toBe("https://example.com/l.jpg");
    expect(resolveImage("https://example.com/t.jpg").url).toBe("https://example.com/huge.png");
    expect(resolveImage("https://other.example/x.jpg").url).toBe("https://other.example/x.jpg");
  });

  it("upgrades Pinterest thumbnails to originals", () => {
    load("https://www.pinterest.com/", "");
    expect(resolveImage("https://i.pinimg.com/474x/12/34/56/x.jpg").url).toBe("https://i.pinimg.com/originals/12/34/56/x.jpg");
  });
});

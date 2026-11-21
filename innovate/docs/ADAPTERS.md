# Ingest adapters

Platform links go through adapters behind one interface (`packages/shared/src/ingest.ts`):
`canHandle(url)`, `fetchMetadata(url)`, `fetchMedia(url) -> stream`. Implementations live in
`packages/shared/src/server/adapters.ts`, run on the worker, and are **off unless configured**.
Uploads and direct video URLs never need an adapter.

| Platform | Status | Why |
|---|---|---|
| Vimeo | Implemented, flag `INGEST_VIMEO_ENABLED` | Uses the official API ([developer.vimeo.com](https://developer.vimeo.com)). Vimeo only returns `download` links to accounts allowed to download a video (the owner, or when the owner enabled downloads), so Innovate imports exactly what the token's account may download, from Vimeo's own CDN hosts. Needs a personal access token with `public private video_files`. |
| YouTube | Not implemented | YouTube's Terms of Service prohibit downloading content except through features YouTube provides. Links are refused with an explanation; the extension saves the page instead. |
| Instagram | Not implemented | Instagram's terms prohibit collecting content by automated means without permission. Same handling as YouTube. |

Before enabling or adding an adapter, re-check the platform's current terms; they change.

## Verification

- Unit tests (`packages/shared/test/adapters.test.ts`) cover URL parsing, picking the source rendition,
  refusing videos the account can't download, bad tokens and unexpected download hosts, and the config flag.
- The e2e test "Vimeo links import through the official-API adapter" runs the full import against a
  local fake of the Vimeo API (`apps/web/e2e/fake-sites.mjs`).
- **Not verified against the live Vimeo API**: no Vimeo token was available while building this. The
  request shape follows Vimeo API 3.4 (`GET /videos/{id}?fields=name,duration,width,height,link,download`).

## Chrome extension capture rules (`apps/extension/src/capture.ts`)

- **Pinterest** pins: the largest `i.pinimg.com` image, rewritten to `/originals/`.
- **ShotDeck** stills: `[data-full-src]`, a download link, or the modal image; `dt/dd` metadata becomes the note.
- **Vimeo** pages: the canonical video URL (imported by the adapter when enabled; otherwise saved as a page).
- Anything else: an `og:video` file if present, otherwise the page with its `og:image`.

These rules are tested against synthetic markup shaped like each site, not the live sites (their markup
changes often, and ShotDeck needs a subscription), so expect to adjust selectors when a site changes.

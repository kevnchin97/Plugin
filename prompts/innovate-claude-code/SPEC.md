# Innovate: product and technical spec

Innovate is a web app where filmmakers and creative teams collect, organize and present visual references in one place. It replaces the screenshot folder, the downloader sites and the separate moodboard app.

Every feature serves one loop: **find a reference, capture the exact moment, organize it, present it, get feedback.**

## 1. Users

Directors, cinematographers, photographers, visual researchers and treatment designers. They think in shots, motion and mood, work to deadlines (pitch, prep, shoot), and notice anything that looks cheap or degrades image quality.

## 2. Design direction

- Dark and image-first, like a grading suite or a film editor, not a SaaS dashboard. The media is the hero and the UI stays quiet around it.
- Near-black neutral surfaces, one restrained accent color, thin dividers, a clean sans serif, and a monospace face for timecodes.
- Masonry grids keep each reference's native aspect ratio. Never crop by default.
- GIFs and clips autoplay muted on hover and pause when off-screen.
- Keyboard-first. Every shortcut is listed in a `?` overlay.
- A light theme as a secondary option.
- Define design tokens (colors, spacing, type scale, radii) in one place and use them everywhere.

## 3. Stack (decided; don't swap without asking)

| Concern | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Web app | Next.js (App Router), TypeScript strict mode, Tailwind CSS |
| UI building blocks | Radix primitives, dnd-kit for drag and drop, TanStack Virtual for large grids |
| Database | Postgres 16 with pgvector, accessed through Drizzle ORM and migrations |
| Media storage | S3-compatible API (MinIO locally, S3 or R2 in production), with a CDN in front of public reads |
| Jobs | BullMQ on Redis, run by a separate Node worker |
| Media processing | ffmpeg and ffprobe on the worker (never in the request path) |
| Auth | Auth.js with email magic link and Google. In development, magic links are printed to the console |
| Realtime | WebSockets (Socket.IO or a thin `ws` server) for comments, presence and board edits |
| AI | Claude API through the official `@anthropic-ai/sdk`, model `claude-opus-5-5` |
| Embeddings | CLIP-style image and text embeddings via `@xenova/transformers` (transformers.js) on the worker, stored in pgvector |
| Extension | Chrome Manifest V3, built with Vite |
| Tests | Vitest for units, Playwright for end-to-end tests |
| Local services | `docker compose` for Postgres, Redis and MinIO |

Repo layout:

```
apps/web         Next.js app (UI and API routes)
apps/worker      BullMQ worker: ingest, transcode, scenes, export, embeddings
apps/extension   Chrome extension
packages/db      Drizzle schema, migrations, seed
packages/media   ffmpeg wrappers, scene detection, GIF encoding (pure and testable)
packages/shared  types, zod schemas, design tokens
```

## 4. Data model

- **User**, **Workspace** and **Membership** (roles: Owner, Editor, Commenter, Viewer).
- **Reference**:
  - Type: `image | gif | clip | still | video | link | note`.
  - Media: storage keys for the original, proxy and thumbnail, plus width, height and duration.
  - Source: `sourceUrl`, `sourcePlatform`, `sourceIn`, `sourceOut`.
  - Lineage: `parentReferenceId` (an extracted GIF or still points to its source video).
  - Content: title, notes, an auto description and an `embedding vector`.
  - Housekeeping: perceptual hash, `createdBy` and timestamps.
- **Scene**: `referenceId`, `index`, `start`, `end`, `thumbnailKey`, `score`.
- **Board**, **Cluster** and **BoardItem** (with ordered positions; an item belongs to a cluster or sits loose on the board).
- **ShotList** and **Shot**: number, setting, description, framing (ECU, CU, MCU, MS, MWS, WS, EWS, OTS, POV, Insert), camera (movement, lens, rig), duration, status (`idea | planned | approved | shot`), `motionReferenceId` and position.
- **Deck** and **Slide** (template plus content blocks), **Reel** and **ReelItem** (with trims), **PortfolioPage**.
- **ShareLink**:
  - Target: `targetType` and `targetId`.
  - Access: `permission` (`view | favorite | comment`), an optional password hash and an optional `expiresAt`.
- **Comment**: target reference within a share or board, optional `timecode`, `parentId` for threads, `resolvedAt`, and an author (a user or a named guest).
- **Favorite**.
- **AgentTask**: prompt, status, step log, proposed outputs and applied outputs.

## 5. Features

### 5.1 GIF Maker (the flagship; make it excellent)

**Input**
- Drag in a local video (MP4, MOV, WebM), paste a direct video URL, or paste an Instagram, YouTube or Vimeo link.
- Platform links go through **ingest adapters** behind one interface: `canHandle(url)`, `fetchMetadata(url)` and `fetchMedia(url) -> stream`.
- Check each platform's terms before enabling its adapter. Prefer official APIs, such as Vimeo's API for videos the user owns. Enable adapters by config flag.
- Uploads and direct URLs must work fully without any adapter.
- Always store the source URL, platform and timecodes on everything extracted.
- Show ingest stages in the UI: fetching, creating a proxy, detecting scenes.

**Processing (worker)**
- Make a low-resolution H.264 proxy for smooth scrubbing.
- Generate a filmstrip sprite sheet (thumbnails at a fixed interval) plus a thumbnail for each scene.
- **Scene detection**: run ffmpeg's scene-change score (`select='gt(scene,T)'` with `showinfo`, or `scdet`), and merge cuts closer together than a minimum shot length. Score each scene for "worth saving" with cheap heuristics (motion energy, duration, contrast) and sort the best first.

**Editor UI**
- A player with a filmstrip timeline underneath: draggable in and out handles, a playhead, zoom, frame-accurate stepping, and timecodes in `HH:MM:SS:FF`.
- A scene list. Clicking a scene seeks to it and sets the in and out points to its bounds.
- Shortcuts:
  - `Space`: play or pause
  - `J` / `K` / `L`: shuttle back, stop, shuttle forward
  - `←` / `→`: step one frame; `Shift+←` / `Shift+→`: step one second
  - `I` / `O`: set the in or out point; `Alt+I` / `Alt+O`: clear it
  - `[` / `]`: previous or next cut
  - `S`: grab a still; `G`: make a GIF; `C`: export a clip
  - `Enter`: save to library

**Outputs (worker jobs, rendered from the original, not the proxy)**
- **Still**: a full-resolution PNG or JPG of the exact frame.
- **GIF**: made in two passes (`palettegen` + `paletteuse`), with options for width, fps, loop or boomerang, and a quality or size slider. Show the estimated size before export.
- **Clip**: an MP4 (H.264 and AAC) trimmed to the range, frame-accurate (re-encode, don't stream-copy).
- **Destination**:
  - Download, with a file name like `source-title_00m12s-00m15s.gif`.
  - Or **Save to Innovate**: pick a board or the inbox. The new item stores `parentReferenceId` and appears next to its source.
- Explain in the UI why GIFs matter: some references only work in motion, like a camera move, a transition, or a feeling a still can't show.

### 5.2 Saving references
- **Chrome extension**:
  - Right-click "Save to Innovate" on images and videos, a toolbar button that saves the current page, and a quick board picker.
  - Site-aware capture for ShotDeck, Pinterest and Vimeo grabs the full-resolution asset and its metadata, not the thumbnail.
  - Authenticate with a token issued from the web app.
- **Text-to-save**: a Twilio SMS or WhatsApp webhook. A user verifies their phone number. Links they text are ingested into an "Inbox from text" board and get a confirmation reply.
- **Uploads**: batch, drag-and-drop, resumable (S3 multipart) uploads for your own footage and pulls.
- Remove duplicates by perceptual hash, offering to link to the existing item instead.

### 5.3 Boards and moodboards
- Boards organized by project, idea or theme, with cover images and a "recently opened" list.
- Masonry layout or free canvas, toggled per board.
- **Clusters**: named groups. Drag and drop within and between clusters and boards, and multi-select with `Shift` or `Cmd`.
- GIFs and clips sit alongside stills, plus text and note blocks.

### 5.4 Shot lists
- A table builder with these columns: #, Setting, Description, Framing, Camera, Duration, Status, Motion reference.
- The Motion reference cell shows an inline looping thumbnail. Click to open it full size. Drag a reference from any board into a row.
- Reorder rows by dragging, group by scene or location, and filter by status.
- Export to PDF (each GIF's first frame plus a link to the motion version) and CSV, and share as a live link.

### 5.5 Decks, treatments, reels and portfolio
- **Decks**:
  - Treatment templates: title, logline, tone, look and feel, characters, locations, shot approach.
  - GIFs and clips play in the deck.
  - Present full-screen in the browser, share as a link, and export to PDF (with posters for motion items).
- **Reels**:
  - Order your best clips on a simple sequence timeline with trims and optional title and end cards.
  - Publish as a branded share link with a clean player, and optionally render one MP4 on the worker.
- **Portfolio pages**: public pages with a few layout templates, a custom slug, and a bio and contact block.

### 5.6 Search and discovery
- **Natural-language library search**:
  - Embed images and sampled video keyframes with CLIP.
  - Embed the query text with the matching CLIP text encoder.
  - Also keep a Claude-generated text description of each reference, for keyword fallback and display.
  - Rank results with pgvector cosine similarity, filtered by type, board, source and date.
- **Research Agent**:
  - Takes a brief such as "melancholic 16mm coming-of-age, golden hour, slow push-ins".
  - Searches Vimeo through its official API and shortlists picks, each with a one-line reason.
  - The user approves the shortlist before the agent saves anything to a board.

### 5.7 Collaboration
- Share links for boards, decks, shot lists and reels, with a permission level, an optional password and an expiry date. Guests need no login and give a display name to comment.
- **Favorites** and **comments pinned to a specific reference** (and to a timecode for motion items), with threads, resolve, @mentions, and email notifications with an optional daily digest.
- An activity feed per board and presence indicators.

### 5.8 AI agents (labelled "limited beta")
- A `Cmd+K` command bar and an agent panel. Example requests:
  - "Research references for a rainy neon chase"
  - "Pull GIFs of every whip pan in this link"
  - "Build a moodboard from my last three uploads"
  - "Draft a treatment deck from *Winter Ad*"
  - "Assemble a 60-second reel of my car work"
- Build the agent on the Claude API (`claude-opus-5-5`). Expose Innovate's own operations as tools: ingest, detect scenes, export, search the library, search Vimeo, and create or update boards, decks and reels. Agents can only do what a user could do in the UI.
- Show the agent run as a task with a live step log, partial results, and cancel and retry buttons.
- Agents **propose**. Nothing is written to boards, decks or reels until the user approves, and every applied change can be undone.
- Before writing agent code, read the current Claude API documentation (or the `claude-api` skill) for tool use, streaming and model parameters. Don't rely on memory.

## 6. Non-functional requirements
- **Performance**:
  - The library grid is interactive in under 1 second with 5,000 items.
  - Scene detection on a 3-minute 1080p clip takes under 30 seconds.
  - A GIF export of a 5-second range takes under 10 seconds.
- **Security**:
  - Scope every query by workspace.
  - Use signed URLs for private media.
  - Rate-limit share links, and hash share passwords.
  - Validate every input with zod.
  - Keep secrets only in `.env`, and list every variable in `.env.example`.
- **Reliability**:
  - Jobs are idempotent and retryable, and report progress.
  - Failed jobs show a clear error in the UI.
- **Accessibility**: everything is reachable by keyboard, focus is always visible, and the app respects reduced-motion settings (in which case GIFs don't autoplay).

## 7. Milestones and definition of done

Each milestone ends with typecheck, lint, unit tests and Playwright tests passing, the app running locally, and a commit.

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold | `docker compose up` plus `pnpm dev` runs the web app and worker. Auth works with a magic link printed to the console. CI runs typecheck, lint and tests. `CLAUDE.md` documents the commands. |
| M1 | GIF Maker on uploads | Upload a video, then see the proxy, filmstrip and detected scenes. Export a still, a GIF and a clip with sound from one range using only the keyboard. Download each. |
| M2 | Library and boards | Save to a board with a parent link back to the source. A masonry grid with native ratios, clusters, drag and drop, and multi-select. |
| M3 | Sharing and feedback | A share link opens without login. A guest favorites a reference and comments on it at a timecode, and the owner sees it live. |
| M4 | Ingest adapters and extension | The adapter interface plus at least one compliant platform adapter. The Chrome extension saves images, videos and pages to a board. |
| M5 | Shot lists | The full builder with motion references, drag-in from boards, and PDF and CSV export. |
| M6 | Search | Natural-language search over images and video keyframes returns relevant results on the seed data. |
| M7 | Decks, reels and portfolio | Build and present a treatment deck with GIFs, publish a reel link, and publish a portfolio page. |
| M8 | Agents and text-to-save | The Research Agent and general agents (propose, approve, undo), and the Twilio text-to-save webhook. |

## 8. Testing strategy
- **Deterministic media fixtures**: generate test videos with ffmpeg in a script (`pnpm fixtures`), for example by joining three solid-color or `testsrc` segments of known lengths with a tone track. Scene detection tests then assert cuts at known timestamps (±1 frame).
- `packages/media` has unit tests for trimming accuracy, GIF palette encoding, and the output dimensions, durations and presence of audio (checked with ffprobe).
- Playwright covers each milestone's "done when" column end to end.
- Never call real external platforms in tests. Use recorded fixtures or mocks.

## 9. Seed data
A demo workspace with boards ("Night Exteriors," "Handheld Intimacy," "Commercial: Winter Ad"), a shot list with motion references, and a treatment deck. Use only generated or royalty-free media.

# Build prompt: Innovate, a visual research workspace for filmmakers

Copy everything below the line into your app builder or coding agent.

---

## Role and goal

You are a senior product engineer and designer. Build **Innovate**, a web app where filmmakers and creative teams collect, organize and present visual references in one place.

Today these people use a folder of screenshots, a few downloader sites and a separate moodboard app. Innovate replaces all three. Every feature should serve one loop: **find a reference, capture the exact moment, organize it, present it, get feedback.**

## Who it is for

Directors, cinematographers, photographers, visual researchers and treatment designers. They think in shots, motion and mood, not in files and folders. They are working on a deadline before a pitch, prep or shoot. They care about craft and will notice anything that looks cheap or degrades image quality.

## Design direction

- A dark, image-first interface that feels like a grading suite or a film editor, not a SaaS dashboard. The media is the hero and the UI stays quiet around it.
- Neutral near-black surfaces, one restrained accent color, generous gutters, thin dividers, and a clean sans serif with a monospace face for timecodes.
- Masonry grids that keep each reference's native aspect ratio. Never crop references by default.
- GIFs and clips autoplay muted on hover and pause off-screen to save resources.
- Fast keyboard-driven workflows throughout, and every shortcut listed in a `?` overlay.
- A light theme as a secondary option.

## Core objects (data model)

- **User** and **Workspace** (a team; members have the roles Owner, Editor, Commenter, Viewer).
- **Reference**: type (image, GIF, video clip, still, link, note), media file(s), thumbnail, source URL, source platform, source timecode in/out, title, notes, auto-generated description and embedding, created by, created at.
- **Board**: a named collection with an ordered layout of references and **Clusters** (named groups inside a board).
- **ShotList**, made of **Shots**: setting, shot description, framing (ECU, CU, MCU, MS, WS, EWS and so on), camera (movement, lens, rig), duration, status (Idea, Planned, Approved, Shot), with an attached motion reference.
- **Deck** (slides built from references and text), **Reel** (an ordered sequence of clips), and **Portfolio Page**.
- **ShareLink**: a public or password-protected link to a board, deck or reel, with permissions (view, favorite, comment).
- **Comment** and **Favorite**, anchored to a specific reference (and optionally a timecode) inside a shared item.
- **AgentTask**: a prompt, status, steps log and output items.

## Features

### 1. GIF Maker (the flagship feature, build it first and make it excellent)

**Input**
- Paste a link from Instagram, YouTube or Vimeo, or drag in a local video file (MP4, MOV, WebM).
- Show ingest progress clearly: fetching, processing, detecting scenes.
- Keep the source URL and timecodes on everything extracted, so each pull always links back to where it came from.

**Scene detection**
- Run automatic shot-boundary detection, for example content-aware detection like PySceneDetect or ffmpeg scene scoring, and show the cuts as a scene list with thumbnails.
- Surface likely "moments worth saving" first, such as strong compositions, camera moves and transitions, so the user does not scrub second by second.
- Clicking a scene jumps the playhead to it and sets the in and out points to its bounds.

**Filmstrip timeline**
- A horizontal filmstrip of frame thumbnails under the player, with draggable in and out handles, a playhead, zoom, and frame-accurate stepping.
- Keyboard shortcuts:
  - `Space`: play or pause
  - `J` / `K` / `L`: shuttle back, stop, shuttle forward
  - `←` / `→`: step one frame; `Shift+←` / `Shift+→`: step one second
  - `I` / `O`: set the in or out point; `Alt+I` / `Alt+O`: clear it
  - `[` / `]`: previous or next detected cut
  - `S`: grab a still; `G`: make a GIF; `C`: export a clip
  - `Enter`: save to library

**Three outputs from any moment**
- **Still frame**: full-resolution PNG or JPG of the current frame.
- **GIF**: from the in and out range, with options for width, frame rate, loop or boomerang, and a quality or size slider. Use palette-optimized encoding so GIFs look good. Show the estimated file size before export.
- **Video clip with sound**: an MP4 (H.264 and AAC) trimmed to the range at source quality.
- Explain in the UI why GIFs matter: some references only work in motion, like a camera move, a transition, or a feeling a still cannot show.

**Destination**
- **Download**: one click, with a clean file name such as `source-title_00m12s-00m15s.gif`.
- **Save to Innovate**: pick a board (or the inbox). The saved item sits next to the reference it came from, and the original video is kept as the parent reference.
- No trip through Premiere: these exports must be ready for decks, treatments and shot lists.

### 2. Saving references

- Save images, videos, GIFs, links and notes from anywhere on the web.
- **Chrome extension (Manifest V3)**: a right-click "Save to Innovate" option on images and videos, a toolbar button that saves the current page, and a quick board picker. Include site-aware capture for ShotDeck, Pinterest and Vimeo that grabs the full-resolution asset and its metadata, not the thumbnail.
- **Text-to-save**: each user gets a phone number (via an SMS or WhatsApp provider such as Twilio). Texting a link, such as an Instagram post, ingests it and drops it into an "Inbox from text" folder automatically, with a confirmation reply.
- **Uploads**: drag and drop your own footage, stills and pulls, with batch upload and resumable uploads for large files. They live in the same library as web saves.
- Remove duplicates by matching each item's perceptual hash.

### 3. Boards and moodboards

- Boards organized by project, idea or theme, with cover images and a "recently opened" list.
- A free canvas or masonry layout, toggled per board.
- **Clusters**: group references into named clusters. Drag and drop references within and between clusters and boards, and multi-select with `Shift` or `Cmd` to move in bulk.
- Moodboards hold GIFs and clips alongside stills, so the board carries movement and atmosphere.
- Notes and text blocks can sit on the board between references.

### 4. Shot lists

- A table-style builder with these columns: #, Setting, Shot description, Framing, Camera, Duration, Status, Motion reference.
- The Motion reference cell shows an inline autoplaying GIF or clip thumbnail. Clicking it opens the reference full size. Drag a reference from any board straight into a row.
- Reorder rows by dragging, group rows by scene or location, and filter by status.
- Export to PDF (with the GIF's first frame and a link to the motion version) and CSV, and share as a live link.
- The goal: show a crew exactly how a shot should feel, with the reference right there in the row.

### 5. Decks, treatments and reels

- **Deck builder**: slide templates for director treatments (title, logline, tone, look and feel, characters, locations, shot approach). Drop in references from the library. GIFs and clips play in the deck, so camera moves show. Present full-screen in the browser, share as a link, and export to PDF (using posters for motion items).
- **Reel builder**: choose your strongest work and arrange it on a simple sequence timeline with trims and an optional title card or end card. Publish it as a polished, branded share link with a clean player, and optionally render a single MP4.
- **Portfolio pages**: public pages for selected work with a few layout templates, a custom slug, and a bio and contact block.

### 6. Search and discovery

- **Natural-language library search**: "night exterior, sodium vapor light, handheld follow" returns matching references with no tagging needed. Implement it with multimodal embeddings (CLIP-style image and frame embeddings, plus text embeddings of auto-generated descriptions) in a vector index. For video, embed sampled keyframes. Combine this with filters for type, board, source and date.
- **Research Agent**: given a brief ("melancholic 16mm coming-of-age, golden hour, slow push-ins"), it searches Vimeo for high-craft work, shortlists results with a short reason for each pick, and saves them to a new or existing board. The user reviews and approves the shortlist before anything is saved.

### 7. Collaboration

- Any board, deck, shot list or reel becomes a share link, with permission levels, an optional password, an expiry date, and no login required for viewers.
- Clients and collaborators can **favorite**, **comment** and **give feedback on specific references**. Comments are pinned to the reference itself (and to a timecode for clips and GIFs), so feedback always has context.
- Threaded replies, resolve or unresolve, @mentions, and email notifications with a daily digest option.
- An activity feed per board, plus presence indicators when teammates are viewing.

### 8. AI agents (labelled "limited beta")

- A command bar (`Cmd+K`) and an agent panel where users can ask for things like:
  - "Research references for a rainy neon chase"
  - "Find five Vimeo shorts with long oners"
  - "Build a moodboard from my last three uploads"
  - "Pull GIFs of every whip pan in this link"
  - "Draft a treatment deck from the board *Winter Ad*"
  - "Assemble a 60-second reel of my car work"
- Agents run as visible multi-step tasks with a live step log, partial results, and cancel or retry buttons. They always propose results before writing to boards, decks or reels, and each agent action can be undone.
- Agents use the same internal tools as the UI (ingest, scene detect, export, search, board, deck and reel operations), so everything an agent does is something a user could do by hand.

## Technical guidance

- **Frontend**: React with TypeScript (Next.js), Tailwind, a drag-and-drop library (for example dnd-kit), and virtualized grids for large libraries.
- **Backend**: Postgres (with pgvector for embeddings), object storage such as S3 or R2 for media with a CDN in front, and a job queue for ingest, scene detection, transcoding and embedding.
- **Media pipeline**: ffmpeg on workers for frame-accurate trims, palette-based GIF encoding, thumbnails and filmstrip sprites; scene detection on workers; preview proxies (low-res MP4s) for smooth scrubbing.
- **Link ingest**: an adapter per platform behind a common interface, so platforms can be added or changed. Respect each platform's terms, store attribution and the source link on every item, and show users a short notice about using references for internal research and pitching.
- **Auth**: email magic link and Google sign-in; workspace invitations.
- **Realtime**: comments, presence and board edits over WebSockets.
- **Performance targets**: library grid interactive in under 1 second for 5,000 items; scene detection on a 3-minute clip in under 30 seconds; GIF export in under 10 seconds for a 5-second range.

## Build order

1. **MVP**: auth and workspaces, upload and link ingest, GIF Maker (scene detection, filmstrip, still, GIF, clip, download, save), library, boards with clusters and drag and drop, share links with comments and favorites.
2. **Next**: Chrome extension, shot lists, natural-language search, text-to-save.
3. **Then**: decks and treatments, reel builder, portfolio pages, Research Agent, then general AI agents (beta).

## Acceptance checks for the MVP

- Pasting a Vimeo link shows detected cuts within seconds, with thumbnails.
- A user can set in and out points with the keyboard alone and export a GIF, a still and a clip with sound from the same range.
- A saved GIF appears in the chosen board next to its parent source, and links back to the original URL and timecode.
- A shared board link opens without login. A viewer can favorite a reference and leave a comment pinned to it, and the owner sees it in real time.
- Grids keep native aspect ratios, and GIFs and clips play on hover without blocking scroll.

## Seed content

Include a demo workspace with sample boards ("Night Exteriors," "Handheld Intimacy," "Commercial: Winter Ad"), a sample shot list with motion references, and a sample treatment deck, so the app feels alive on first run.

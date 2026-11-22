# Innovate

A visual research workspace for filmmakers and creative teams: find a reference, capture the exact
moment, organize it, present it, get feedback. Spec: [`../prompts/innovate-claude-code/SPEC.md`](../prompts/innovate-claude-code/SPEC.md).

**Status:** M0–M8 are built. See `CLAUDE.md` for commands and conventions.

## Desktop app (Windows)

Download **Innovate-Setup-<version>.exe** from the latest green `innovate-ci` run on GitHub (Actions → the run →
Artifacts → `Innovate-Setup-windows`), unzip it and run the installer. It installs for your user only, adds a
Start-menu and desktop shortcut, and opens straight onto your boards: no Docker, no sign-in, nothing else to install.

- Your boards, files and database live in `%APPDATA%\Innovate\data`; uninstalling keeps them.
- The first search by look downloads the CLIP model (~150 MB) once.
- The installer isn't code-signed, so Windows SmartScreen asks first: **More info → Run anyway**.
- It's one person on one computer: no share links for other people, no text-to-save.

Build it yourself on Windows: `pnpm install --config.node-linker=hoisted`, then `pnpm --filter @innovate/desktop package`
(installer in `apps/desktop/dist/`).

## Server quick start

Requires Node 22.12+, pnpm 10, Docker, and ffmpeg/ffprobe on the PATH (the worker shells out to them).

```bash
cd innovate
cp .env.example .env             # then set AUTH_SECRET (openssl rand -base64 32)
pnpm install
pnpm services:up                 # Postgres 16 + pgvector, Redis, MinIO
pnpm db:migrate
pnpm dev                         # web on http://localhost:3000 + worker
```

Sign in with any email; the magic link is printed in the terminal. Open **GIF Maker**, drop a video, and press `?`
for the shortcuts. Optional demo data: `pnpm db:seed && pnpm --filter @innovate/worker seed:media`, then sign in
as `demo@innovate.local`.

## Tests

```bash
pnpm fixtures      # generate deterministic test videos with ffmpeg
pnpm typecheck && pnpm lint && pnpm test
pnpm e2e           # Playwright: needs services up + migrations
```

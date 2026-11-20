# Innovate

A visual research workspace for filmmakers and creative teams: find a reference, capture the exact
moment, organize it, present it, get feedback. Spec: [`../prompts/innovate-claude-code/SPEC.md`](../prompts/innovate-claude-code/SPEC.md).

**Status:** M0 (scaffold) and M1 (GIF Maker on uploads) are built. See `CLAUDE.md` for commands and conventions.

## Quick start

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

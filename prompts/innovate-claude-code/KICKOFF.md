# Kickoff prompt for Claude Code

**How to use it**
1. Create an empty repo and add `SPEC.md` (from this folder) to its root.
2. Open Claude Code in that repo and paste the prompt below. Plan mode (`Shift+Tab`) works well for the first message.
3. After each checkpoint, review what was built, then reply "continue with M2" (and so on) to move to the next milestone.

---

We're building **Innovate**, a visual research workspace for filmmakers and creative teams. The full product and technical spec is in `SPEC.md`. Read the whole file before doing anything else. It's the source of truth, so if something here conflicts with it, follow `SPEC.md` and tell me about the conflict.

**Scope for this session:** milestones **M0 (Scaffold)** and **M1 (GIF Maker on uploads)** only. Stop after M1 and report back. Don't start M2.

**How I want you to work**

1. **Plan first.** Before writing code, give me a short plan for M0 and M1 covering:
   - the packages and key files you'll create
   - the database tables M1 needs
   - the job types, and how the web app and the worker talk to each other
   - how you'll test scene detection and exports deterministically

   Flag any decision in the spec you think is wrong, and wait for my OK on the plan.
2. **Set up the project memory early.** In M0, create `CLAUDE.md` with the commands for dev, test, lint, typecheck, migrations and fixtures, the repo layout, and the conventions you're following. Keep it up to date as things change.
3. **Use the stack in `SPEC.md` §3.** Don't add services, paid APIs or major dependencies beyond it without asking. Put all configuration in environment variables, list every one in `.env.example`, and never commit secrets.
4. **Media work stays on the worker.** ffmpeg never runs in a request handler. Jobs are idempotent, report progress, and show readable errors in the UI.
5. **Test as you go.**
   - Generate deterministic fixture videos with ffmpeg (SPEC §8) and unit-test scene detection, trim accuracy (±1 frame), GIF output, and that clips have audio (checked with ffprobe).
   - Write Playwright tests for the M1 "done when" criteria: upload, scenes appear, and exporting a still, a GIF and a clip using the keyboard only.
6. **Verify for real.** Before calling a milestone done:
   - run typecheck, lint, unit tests and the Playwright tests, and fix any failures
   - start the app and click through the GIF Maker flow yourself in a headless browser
   - take screenshots of the editor so I can see the design
7. **Commit at sensible checkpoints** with clear messages: at least once at the end of M0 and once at the end of M1.
8. **Be honest about gaps.** Don't silently stub or fake functionality. If something is mocked, incomplete or deferred, list it in your report and add a `TODO(M#)` comment in the code.

**Quality bar for M1.** The GIF Maker is the flagship, so the editor should feel like a professional tool:
- smooth proxy scrubbing
- a crisp filmstrip
- frame-accurate in and out points and timecodes in `HH:MM:SS:FF`
- every shortcut in SPEC §5.1 working, and listed in a `?` overlay
- the dark, image-first look described in SPEC §2

GIFs must use two-pass palette encoding and look clean. Clips must keep their sound.

**When you finish M1, report:**
- what was built, and how to run it (exact commands)
- test results (pass and fail counts) and the screenshots
- anything mocked, skipped or deferred
- decisions you made that weren't in the spec
- the risks or open questions I should settle before M2

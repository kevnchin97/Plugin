/**
 * Build the desktop app: stage everything in .stage/, then electron-builder makes the installer in
 * dist/ (Windows: Innovate-Setup-<version>.exe). Run on the target OS (native AI runtime, ffmpeg).
 *
 *   node scripts/package.mjs [--skip-web] [--dir]      (--dir: unpacked app only, no installer)
 *
 * The web build needs hoisted node_modules (pnpm install --config.node-linker=hoisted) so the
 * standalone server has real folders, not pnpm symlinks.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(desktop, "../..");
const web = join(repo, "apps/web");
const stage = join(desktop, ".stage");
const args = new Set(process.argv.slice(2));
const pkg = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
const sh = (cmd, cwd = desktop) => execSync(cmd, { cwd, stdio: "inherit", env: process.env });

/** Packages loaded at runtime with native code, WebAssembly or data files: installed, not bundled. */
const EXTERNAL = ["@xenova/transformers", "@electric-sql/pglite", "@electric-sql/pglite-pgvector", "pdfkit", "ffmpeg-static", "ffprobe-static"];

/** Not used elsewhere in the workspace, so pinned here: ffmpeg and ffprobe builds for the target OS. */
const PINNED = { "ffmpeg-static": "5.3.0", "ffprobe-static": "3.1.0" };

/** The version the workspace was built and tested with (read from the installed package.json). */
function versionOf(name) {
  if (PINNED[name]) return PINNED[name];
  for (const from of ["apps/worker", "packages/db", "apps/desktop", "."]) {
    const file = join(repo, from, "node_modules", name, "package.json");
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).version;
  }
  throw new Error(`Can't find the installed version of ${name}`);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "app"), { recursive: true });

// 1. The web app (Next.js standalone).
if (!args.has("--skip-web")) sh("node scripts/build-web.mjs");
const standalone = join(web, ".next/standalone");
if (!existsSync(join(standalone, "apps/web/server.js"))) throw new Error("No standalone web build. Run without --skip-web.");
if (lstatSync(join(standalone, "apps/web/node_modules/next"), { throwIfNoEntry: false })?.isSymbolicLink())
  throw new Error("The standalone build has pnpm symlinks. Install with: pnpm install --config.node-linker=hoisted");
cpSync(standalone, join(stage, "web"), { recursive: true, verbatimSymlinks: true });

// 2. The server: one ESM bundle plus the packages above.
await build({
  entryPoints: [join(desktop, "src/server.ts")],
  outfile: join(stage, "server/server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: [...EXTERNAL, "bufferutil", "utf-8-validate"],
  banner: {
    js: [
      'import { createRequire as __innovateRequire } from "node:module";',
      'import { fileURLToPath as __innovateFileUrl } from "node:url";',
      'import { dirname as __innovateDirname } from "node:path";',
      "const require = __innovateRequire(import.meta.url);",
      "const __filename = __innovateFileUrl(import.meta.url);",
      "const __dirname = __innovateDirname(__filename);",
    ].join("\n"),
  },
  logLevel: "warning",
});
writeFileSync(
  join(stage, "server/package.json"),
  JSON.stringify({ name: "innovate-server", private: true, type: "module", dependencies: Object.fromEntries(EXTERNAL.map((n) => [n, versionOf(n)])) }, null, 2),
);
sh("npm install --omit=dev --no-audit --no-fund --no-package-lock", join(stage, "server"));
// onnxruntime-node and ffprobe-static ship every platform's binaries; keep this one's.
const ortBin = join(stage, "server/node_modules/onnxruntime-node/bin/napi-v3");
if (existsSync(ortBin))
  for (const platform of ["darwin", "linux", "win32"]) if (platform !== process.platform) rmSync(join(ortBin, platform), { recursive: true, force: true });
const probeBin = join(stage, "server/node_modules/ffprobe-static/bin");
if (existsSync(probeBin)) {
  for (const platform of ["darwin", "linux", "win32"]) if (platform !== process.platform) rmSync(join(probeBin, platform), { recursive: true, force: true });
  for (const arch of ["ia32", "x64", "arm64"]) if (arch !== process.arch) rmSync(join(probeBin, process.platform, arch), { recursive: true, force: true });
}

// 3. Migrations and the Electron app.
cpSync(join(repo, "packages/db/drizzle"), join(stage, "migrations"), { recursive: true });
for (const f of ["main.cjs", "loading.html"]) cpSync(join(desktop, "electron", f), join(stage, "app", f));
writeFileSync(
  join(stage, "app/package.json"),
  JSON.stringify({ name: "innovate", productName: "Innovate", version: pkg.version, description: "Visual research boards for filmmakers", author: "Innovate", main: "main.cjs" }, null, 2),
);

// 4. Installer (or just the unpacked app with --dir).
sh(`npx electron-builder --config electron-builder.yml ${args.has("--dir") ? "--dir" : ""} --publish never`);
console.log("Built:", join(desktop, "dist"));

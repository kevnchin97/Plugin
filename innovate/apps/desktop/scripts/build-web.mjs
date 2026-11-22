// Build the web app as a Next.js standalone server for the desktop app, with its static assets.
import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "../../web");
const out = join(web, ".next/standalone");
rmSync(out, { recursive: true, force: true });
execSync("pnpm build", { cwd: web, stdio: "inherit", env: { ...process.env, NEXT_OUTPUT: "standalone" } });
cpSync(join(web, ".next/static"), join(out, "apps/web/.next/static"), { recursive: true });
if (existsSync(join(web, "public"))) cpSync(join(web, "public"), join(out, "apps/web/public"), { recursive: true });
console.log(`standalone web app: ${out}`);

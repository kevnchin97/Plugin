/**
 * M1 seed: a demo user + workspace. Sign in as demo@innovate.local to see it.
 * The generated demo film is uploaded by `pnpm --filter @innovate/worker seed:media`
 * (needs the worker's S3 + queue config). TODO(M2+): boards "Night Exteriors",
 * "Handheld Intimacy", "Commercial: Winter Ad", a shot list and a treatment deck (SPEC §9).
 */
import "./env";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { users, workspaces } from "./schema";
import { ensurePersonalWorkspace } from "./workspace";

const db = getDb();
const email = "demo@innovate.local";
let [user] = await db.select().from(users).where(eq(users.email, email));
if (!user) [user] = await db.insert(users).values({ email, name: "Demo", emailVerified: new Date() }).returning();
if (!user) throw new Error("seed: could not create demo user");
const ws = await ensurePersonalWorkspace(db, user.id, "Demo");
await db.update(workspaces).set({ name: "Demo workspace" }).where(eq(workspaces.id, ws.id));
console.log(`seeded ${email} (workspace ${ws.id})`);
await closeDb();

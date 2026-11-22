import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Redis } from "ioredis";
import { startRealtime } from "./server";

config({ path: resolve(fileURLToPath(new URL("../../../", import.meta.url)), ".env"), quiet: true });

const sub = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const server = await startRealtime({
  port: Number(process.env.REALTIME_PORT || 3001),
  async subscribe(on) {
    await sub.psubscribe("rt:*");
    sub.on("pmessage", (_pattern, channel, message) => on(channel, message));
    return () => sub.disconnect();
  },
});

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

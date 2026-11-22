import { closeDb } from "@innovate/db";
import { startWorkers } from "./workers";

const workers = await startWorkers();

const shutdown = async () => {
  console.log("[worker] shutting down");
  await workers.close();
  await closeDb();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

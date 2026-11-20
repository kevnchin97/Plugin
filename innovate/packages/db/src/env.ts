// Load innovate/.env for CLI scripts (migrate, seed, drizzle-kit). Apps load env themselves.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

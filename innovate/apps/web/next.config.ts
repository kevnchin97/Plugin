import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One .env for the whole monorepo (innovate/.env).
loadEnvConfig(resolve(process.cwd(), "../.."));

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@innovate/shared", "@innovate/db"],
  serverExternalPackages: ["bullmq", "postgres", "@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  // The desktop app runs the standalone build (one folder with a server.js and only the files it needs).
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const, outputFileTracingRoot: resolve(process.cwd(), "../..") } : {}),
  poweredByHeader: false,
  typedRoutes: false,
  devIndicators: false,
  agentRules: false,
};

export default config;

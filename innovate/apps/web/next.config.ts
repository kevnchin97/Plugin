import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One .env for the whole monorepo (innovate/.env).
loadEnvConfig(resolve(process.cwd(), "../.."));

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@innovate/shared", "@innovate/db"],
  serverExternalPackages: ["bullmq", "postgres"],
  poweredByHeader: false,
  typedRoutes: false,
  devIndicators: false,
  agentRules: false,
};

export default config;

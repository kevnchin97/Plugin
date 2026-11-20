import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import NextAuth, { type NextAuthConfig } from "next-auth";
import type { EmailConfig, Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { accounts, ensurePersonalWorkspace, sessions, users, verificationTokens } from "@innovate/db";
import { env } from "@/lib/env";
import { db } from "@/lib/server";

/** Development magic links: printed to the server console (and optionally a file for e2e tests). */
function consoleEmail(): EmailConfig {
  return {
    id: "email",
    type: "email",
    name: "Email",
    from: env().EMAIL_FROM,
    maxAge: 24 * 60 * 60,
    options: {},
    async sendVerificationRequest({ identifier, url }) {
      if (process.env.NODE_ENV === "production" && process.env.INNOVATE_E2E !== "1")
        throw new Error("Email sign-in isn't configured. Set EMAIL_SERVER.");
      const bar = "─".repeat(72);
      console.log(`\n${bar}\n  Innovate magic link for ${identifier}\n  ${url}\n${bar}\n`);
      const file = env().MAGIC_LINK_LOG_FILE;
      if (file) mkdirSync(dirname(file), { recursive: true });
      if (file) appendFileSync(file, JSON.stringify({ email: identifier, url, at: new Date().toISOString() }) + "\n");
    },
  };
}

function providers(): Provider[] {
  const e = env();
  const list: Provider[] = [e.EMAIL_SERVER ? Nodemailer({ id: "email", server: e.EMAIL_SERVER, from: e.EMAIL_FROM }) : consoleEmail()];
  if (e.AUTH_GOOGLE_ID && e.AUTH_GOOGLE_SECRET) list.push(Google({ clientId: e.AUTH_GOOGLE_ID, clientSecret: e.AUTH_GOOGLE_SECRET }));
  return list;
}

export const googleEnabled = () => Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

const config: NextAuthConfig = {
  adapter: DrizzleAdapter(db(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: providers(),
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login", verifyRequest: "/login/check-email", error: "/login" },
  trustHost: true,
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) await ensurePersonalWorkspace(db(), user.id, user.name);
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);

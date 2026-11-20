import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { auth, googleEnabled, signIn } from "@/auth";
import { Logo } from "@/components/ui/Logo";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  Verification: "That sign-in link has expired or was already used. Request a new one.",
  invalid_email: "Enter a valid email address.",
  Default: "Sign-in failed. Try again.",
};

async function emailSignIn(formData: FormData) {
  "use server";
  const email = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!email.success) redirect("/login?error=invalid_email");
  try {
    await signIn("email", { email: email.data, redirectTo: "/", redirect: false });
  } catch (err) {
    if (err instanceof AuthError) redirect("/login?error=Default");
    throw err;
  }
  redirect("/login/check-email");
}

async function googleSignIn() {
  "use server";
  await signIn("google", { redirectTo: "/" });
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if ((await auth())?.user) redirect("/");
  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? ERRORS.Default) : null;
  return (
    <main className="grid min-h-full place-items-center px-6">
      <div className="w-full max-w-[340px]">
        <div className="mb-10 text-text">
          <Logo />
        </div>
        <h1 className="text-xl font-semibold tracking-[-0.01em]">Sign in</h1>
        <p className="mt-1 text-text-muted">Find it, cut it, keep it. We&apos;ll email you a one-time link.</p>
        {message && (
          <p role="alert" className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {message}
          </p>
        )}
        <form action={emailSignIn} className="mt-6 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm text-text-muted">Email</span>
            <input
              name="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@studio.com"
              className="h-9 w-full rounded-md border border-border-strong bg-surface-2 px-3 text-md text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
            />
          </label>
          <button type="submit" className="h-9 w-full rounded-md bg-accent text-md font-medium text-accent-fg hover:bg-accent-strong">
            Email me a sign-in link
          </button>
        </form>
        {googleEnabled() && (
          <form action={googleSignIn} className="mt-3">
            <button type="submit" className="h-9 w-full rounded-md border border-border-strong bg-surface-2 text-md hover:bg-surface-3">
              Continue with Google
            </button>
          </form>
        )}
        {process.env.NODE_ENV !== "production" && (
          <p className="mt-8 text-xs text-text-faint">Development: the link is printed in the terminal running the web app.</p>
        )}
      </div>
    </main>
  );
}

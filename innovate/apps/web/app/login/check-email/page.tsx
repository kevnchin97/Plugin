import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

export const metadata = { title: "Check your email" };

export default function CheckEmail() {
  return (
    <main className="grid min-h-full place-items-center px-6">
      <div className="w-full max-w-[340px]">
        <div className="mb-10 text-text">
          <Logo />
        </div>
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="mt-2 text-text-muted">A sign-in link is on its way. It works once and expires in 24 hours.</p>
        {process.env.NODE_ENV !== "production" && (
          <p className="mt-4 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">
            Running locally? The link is printed in the web server&apos;s terminal.
          </p>
        )}
        <Link href="/login" className="mt-6 inline-block text-sm text-text-muted underline-offset-4 hover:text-text hover:underline">
          Use a different email
        </Link>
      </div>
    </main>
  );
}

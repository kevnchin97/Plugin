"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/ui/Logo";

export function SharePassword({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="grid min-h-full place-items-center px-6">
      <form
        className="w-full max-w-[320px]"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const res = await fetch(`/api/s/${token}/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
          setBusy(false);
          if (res.ok) router.refresh();
          else setError((await res.json().catch(() => ({}))).error ?? "That didn't work.");
        }}
      >
        <div className="mb-8 text-text">
          <Logo />
        </div>
        <h1 className="text-xl font-semibold">This board is protected</h1>
        <p className="mt-1 text-text-muted">Enter the password you were given.</p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Password"
          className="mt-5 h-9 w-full rounded-md border border-border-strong bg-surface-2 px-3 text-md focus:border-accent focus:outline-none"
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !password} className="mt-3 h-9 w-full rounded-md bg-accent text-md font-medium text-accent-fg hover:bg-accent-strong disabled:opacity-50">
          Open board
        </button>
      </form>
    </main>
  );
}

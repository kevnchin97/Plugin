"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toasts";

interface Token {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

function Section({ title, children, hint }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border py-6">
      <h2 className="text-md font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 mb-3 text-sm text-text-muted">{hint}</p>}
      {children}
    </section>
  );
}

export function Settings({ email, appUrl, mode: initialMode, tokens: initial }: { email: string; appUrl: string; mode: "immediate" | "digest" | "off"; tokens: Token[] }) {
  const toast = useToast();
  const [tokens, setTokens] = useState(initial);
  const [fresh, setFresh] = useState<string | null>(null);
  const [mode, setMode] = useState(initialMode);

  const create = async () => {
    const res = await fetch("/api/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Chrome extension" }) });
    const json = await res.json();
    if (!res.ok) return toast(json.error ?? "Couldn't create a token.", "error");
    setFresh(json.token);
    setTokens((t) => [{ id: json.id, name: "Chrome extension", prefix: json.prefix, lastUsedAt: null, createdAt: new Date().toISOString() }, ...t]);
  };
  const revoke = async (id: string) => {
    const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    if (res.ok) setTokens((t) => t.filter((x) => x.id !== id));
  };
  const saveMode = async (m: typeof mode) => {
    setMode(m);
    const res = await fetch("/api/settings/notifications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: m }) });
    if (res.ok) toast("Saved", "success");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[720px] px-6 py-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">Settings</h1>
        <p className="text-sm text-text-muted">{email}</p>

        <Section title="Browser extension" hint="Save images, videos and pages to Innovate from Chrome. The extension signs in with a personal token.">
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-text-muted">
            <li>
              Build it: <code className="rounded-xs bg-surface-3 px-1 font-mono text-xs">pnpm --filter @innovate/extension build</code>, then load{" "}
              <code className="rounded-xs bg-surface-3 px-1 font-mono text-xs">apps/extension/dist</code> in chrome://extensions (Developer mode → Load unpacked).
            </li>
            <li>Create a token here and paste it, with this address, into the extension&apos;s options.</li>
          </ol>
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => void create()}>
              Create token
            </Button>
            <span className="text-xs text-text-faint">
              Innovate address: <code className="font-mono">{appUrl}</code>
            </span>
          </div>
          {fresh && (
            <div className="mt-3 rounded-md border border-accent-line bg-accent-soft p-3 text-sm" role="status">
              Copy this token now; it won&apos;t be shown again.
              <input readOnly value={fresh} onFocus={(e) => e.currentTarget.select()} aria-label="New token" data-testid="new-token" className="mt-2 h-8 w-full rounded-sm border border-border-strong bg-surface px-2 font-mono text-xs" />
            </div>
          )}
          <ul className="mt-4 space-y-2" data-testid="tokens">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm">
                <span>
                  {t.name} <code className="ml-1 font-mono text-xs text-text-faint">{t.prefix}…</code>
                  <span className="ml-2 text-xs text-text-faint">{t.lastUsedAt ? `last used ${new Date(t.lastUsedAt).toLocaleString()}` : "never used"}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => void revoke(t.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Email notifications" hint="When someone comments on or favorites something on your boards.">
          <div className="flex gap-2" role="radiogroup" aria-label="Email notifications">
            {(
              [
                ["immediate", "Right away"],
                ["digest", "Daily digest"],
                ["off", "Off"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => void saveMode(m)}
                className={`h-8 rounded-md border px-3 text-sm ${mode === m ? "border-accent-line bg-accent-soft text-text" : "border-border-strong text-text-muted hover:text-text"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

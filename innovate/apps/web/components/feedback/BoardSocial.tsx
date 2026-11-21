"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { createContext, useContext, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { ActivityDTO } from "@/lib/feedback";
import type { Member } from "@/lib/useRealtime";

/* ---------- badges on cards ---------- */

export interface FeedbackCounts {
  counts: Record<string, { comments: number; favorites: number }>;
  open(referenceId: string): void;
}
export const FeedbackContext = createContext<FeedbackCounts | null>(null);
export const useFeedbackCounts = () => useContext(FeedbackContext);

export function Badges({ referenceId }: { referenceId: string }) {
  const ctx = useFeedbackCounts();
  const c = ctx?.counts[referenceId];
  // Only when there's something to see; double-clicking the card opens feedback either way.
  if (!ctx || !c || (c.comments === 0 && c.favorites === 0)) return null;
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        ctx.open(referenceId);
      }}
      className="absolute top-2 right-2 flex items-center gap-1.5 rounded-xs bg-black/70 px-1.5 py-px text-2xs font-medium text-white/90 opacity-80 hover:opacity-100"
      title="Comments and favorites"
      aria-label={`Open feedback: ${c.comments} comments, ${c.favorites} favorites`}
      data-testid="feedback-badge"
    >
      <span className="tabular" data-testid="badge-comments">
        ✎ {c.comments}
      </span>
      {c.favorites > 0 && <span className="tabular">♥ {c.favorites}</span>}
    </button>
  );
}

/* ---------- presence ---------- */

const COLORS = ["#a4481a", "#2e6f8e", "#6b5a2e", "#7a3e6b", "#2e7a4f", "#8a5a12"];
function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length]!;
}

export function Presence({ members, selfId }: { members: Member[]; selfId?: string }) {
  const others = members.filter((m) => m.id !== selfId);
  if (!others.length) return null;
  return (
    <div className="flex items-center -space-x-1.5" aria-label={`Also here: ${others.map((m) => m.name).join(", ")}`} data-testid="presence">
      {others.slice(0, 5).map((m) => (
        <span
          key={m.id}
          title={`${m.name}${m.kind === "guest" ? " (guest)" : ""}`}
          className="grid h-6 w-6 place-items-center rounded-full border-2 border-bg text-2xs font-semibold text-white"
          style={{ background: colorFor(m.id) }}
        >
          {m.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {others.length > 5 && <span className="pl-2 text-2xs text-text-faint">+{others.length - 5}</span>}
    </div>
  );
}

/* ---------- activity ---------- */

export function ActivityList({ entries }: { entries: ActivityDTO[] }) {
  const describe = (e: ActivityDTO) => {
    const p = e.payload as { title?: string; timecode?: number | null; body?: string; count?: number; permission?: string };
    switch (e.kind) {
      case "comment":
        return (
          <>
            commented on <b className="font-medium">{p.title}</b>
            {p.timecode != null && <span className="timecode text-text-faint"> at {Math.floor(p.timecode / 60)}:{(p.timecode % 60).toFixed(1).padStart(4, "0")}</span>}
            {p.body && <span className="block truncate text-text-muted">“{p.body}”</span>}
          </>
        );
      case "favorite":
        return (
          <>
            favorited <b className="font-medium">{p.title}</b>
          </>
        );
      case "share":
        return <>created a {p.permission} link</>;
      case "added":
        return (
          <>
            added {p.count} {p.count === 1 ? "reference" : "references"}
          </>
        );
      default:
        return <>{e.kind}</>;
    }
  };
  return (
    <ul className="space-y-2.5 px-3.5 py-3 text-xs" data-testid="activity">
      {entries.map((e) => (
        <li key={e.id} className="leading-[17px]">
          <span className="font-medium">{e.actorName}</span> {describe(e)}
          <span className="block text-2xs text-text-faint">{new Date(e.createdAt).toLocaleString()}</span>
        </li>
      ))}
      {entries.length === 0 && <li className="text-text-faint">Nothing yet. Comments, favorites and shares show up here.</li>}
    </ul>
  );
}

/* ---------- share dialog ---------- */

interface Share {
  id: string;
  token: string;
  permission: "view" | "favorite" | "comment";
  hasPassword: boolean;
  expiresAt: string | null;
  path: string;
}

const PERM_LABEL = { view: "Can view", favorite: "Can view and favorite", comment: "Can view, favorite and comment" } as const;

export function ShareDialog({
  boardId,
  endpoint = `/api/boards/${boardId}/shares`,
  viewOnly = false,
  noun = "board",
  onError,
}: {
  boardId: string;
  endpoint?: string;
  /** Shot lists share as view-only live links, so the access picker is hidden. */
  viewOnly?: boolean;
  noun?: string;
  onError(m: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [permission, setPermission] = useState<Share["permission"]>("comment");
  const [password, setPassword] = useState("");
  const [expires, setExpires] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetch(endpoint).then(async (r) => r.ok && setShares((await r.json()).shares));
  }, [open, endpoint]);

  const create = async () => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permission, password: password || undefined, expiresAt: expires || undefined }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return onError(json.error ?? "Couldn't create the link.");
    setShares((s) => [json.share, ...s]);
    setPassword("");
  };
  const revoke = async (id: string) => {
    const res = await fetch(`/api/shares/${id}`, { method: "DELETE" });
    if (res.ok) setShares((s) => s.filter((x) => x.id !== id));
  };
  const url = (s: Share) => `${window.location.origin}${s.path}`;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button size="sm" variant="secondary">
          Share
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-strong bg-surface p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] focus:outline-none"
        >
          <Dialog.Title className="text-lg font-semibold">Share this {noun}</Dialog.Title>
          <p className="mt-1 text-sm text-text-muted">
            {viewOnly
              ? `Anyone with the link sees the ${noun} live, without an account.`
              : "Anyone with the link can open it without an account. Guests give a name to favorite or comment."}
          </p>
          <div className="mt-4 grid grid-cols-[1fr_1fr] gap-2.5">
            <label className={`col-span-2 text-xs text-text-muted ${viewOnly ? "hidden" : ""}`}>
              Access
              <select value={permission} onChange={(e) => setPermission(e.target.value as Share["permission"])} className="mt-1 h-8 w-full rounded-md border border-border-strong bg-surface-2 px-2 text-sm text-text" aria-label="Link access">
                {(["view", "favorite", "comment"] as const).map((p) => (
                  <option key={p} value={p}>
                    {PERM_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-text-muted">
              Password (optional)
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 h-8 w-full rounded-md border border-border-strong bg-surface-2 px-2 text-sm text-text" aria-label="Link password" autoComplete="new-password" />
            </label>
            <label className="text-xs text-text-muted">
              Expires (optional)
              <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="mt-1 h-8 w-full rounded-md border border-border-strong bg-surface-2 px-2 text-sm text-text" aria-label="Link expiry date" />
            </label>
          </div>
          <Button className="mt-3" variant="primary" size="sm" onClick={() => void create()}>
            Create link
          </Button>
          <ul className="mt-4 space-y-2" data-testid="share-links">
            {shares.map((s) => (
              <li key={s.id} className="rounded-md border border-border bg-surface-2 p-2.5">
                <div className="flex items-center gap-2">
                  <input readOnly value={url(s)} className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-surface px-2 font-mono text-2xs" aria-label="Share link" data-testid="share-url" onFocus={(e) => e.currentTarget.select()} />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void navigator.clipboard?.writeText(url(s)).catch(() => {});
                      setCopied(s.id);
                    }}
                  >
                    {copied === s.id ? "Copied" : "Copy"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void revoke(s.id)}>
                    Turn off
                  </Button>
                </div>
                <div className="mt-1 text-2xs text-text-faint">
                  {PERM_LABEL[s.permission]}
                  {s.hasPassword && " · password"}
                  {s.expiresAt && ` · expires ${new Date(s.expiresAt).toLocaleDateString()}`}
                </div>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

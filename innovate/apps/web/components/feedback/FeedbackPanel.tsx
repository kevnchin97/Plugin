"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatTimecode, secondsToFrame } from "@innovate/shared";
import { aspectOf } from "@/components/board/cards";
import { MotionMedia } from "@/components/media/MotionMedia";
import { Button } from "@/components/ui/Button";
import type { RefLite } from "@/lib/boards";
import type { CommentDTO } from "@/lib/feedback";

export interface FeedbackApi {
  /** POST { action: "favorite" | comment fields } */
  feedbackUrl: string;
  mediaUrl: string;
  resolveUrl?: (commentId: string) => string;
  /** Extra body fields (e.g. boardId for share links). */
  extra?: Record<string, unknown>;
}

interface Props {
  reference: RefLite;
  comments: CommentDTO[];
  favorite: { count: number; mine: boolean };
  api: FeedbackApi;
  canFavorite: boolean;
  canComment: boolean;
  canResolve: boolean;
  /** Guests must have a name before favoriting/commenting; resolves false if they cancel. */
  ensureName?: () => Promise<boolean>;
  onClose(): void;
  onFavorite(r: { on: boolean; count: number }): void;
  onComment(c: CommentDTO): void;
  onError(msg: string): void;
}

const MOTION = new Set(["video", "clip"]);

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function Body({ text }: { text: string }) {
  const parts = text.split(/((?:^|\s)@[\p{L}\p{N}._-]{1,40})/gu);
  return (
    <p className="text-sm leading-5 whitespace-pre-wrap">
      {parts.map((p, i) => (p.trim().startsWith("@") ? <span key={i} className="font-medium text-accent">{p}</span> : <span key={i}>{p}</span>))}
    </p>
  );
}

export function FeedbackPanel(p: Props) {
  const { reference: ref } = p;
  const motion = MOTION.has(ref.type);
  const fps = ref.fps ?? { num: 25, den: 1 };
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [attachTc, setAttachTc] = useState(motion);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!motion) return;
    let cancelled = false;
    void fetch(p.api.mediaUrl).then(async (r) => {
      if (r.ok && !cancelled) setPlayUrl((await r.json()).playUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [motion, p.api.mediaUrl]);

  const frame = secondsToFrame(time, fps);
  const threads = useMemo(() => {
    const top = p.comments.filter((c) => !c.parentId && (showResolved || !c.resolvedAt));
    top.sort((a, b) => (a.timecode ?? -1) - (b.timecode ?? -1) || a.createdAt.localeCompare(b.createdAt));
    return top.map((c) => ({ c, replies: p.comments.filter((r) => r.parentId === c.id) }));
  }, [p.comments, showResolved]);
  const resolvedCount = p.comments.filter((c) => !c.parentId && c.resolvedAt).length;

  const seek = (seconds: number) => {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = seconds + 0.5 / (fps.num / fps.den);
    setTime(seconds);
  };

  const post = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    if (p.ensureName && !(await p.ensureName())) return;
    setBusy(true);
    try {
      const res = await fetch(p.api.feedbackUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...p.api.extra,
          referenceId: ref.id,
          body,
          parentId: replyTo,
          timecode: motion && attachTc && !replyTo ? frame / (fps.num / fps.den) : null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't post that.");
      p.onComment(json.comment);
      // Only clear what was posted: the person may have started the next comment meanwhile.
      setDraft((d) => (d.trim() === body ? "" : d));
      setReplyTo(null);
    } catch (err) {
      p.onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const favorite = async () => {
    if (p.ensureName && !(await p.ensureName())) return;
    const res = await fetch(p.api.feedbackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...p.api.extra, action: "favorite", referenceId: ref.id }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return p.onError(json.error ?? "Couldn't save that.");
    p.onFavorite(json);
  };

  const resolve = async (c: CommentDTO) => {
    if (!p.api.resolveUrl) return;
    const res = await fetch(p.api.resolveUrl(c.id), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolved: !c.resolvedAt }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return p.onError(json.error ?? "Couldn't update that.");
    p.onComment(json.comment);
  };

  return (
    <aside className="flex min-h-0 w-[380px] shrink-0 flex-col border-l border-border bg-surface" aria-label={`Feedback on ${ref.title}`} data-testid="feedback-panel">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3.5">
        <h2 className="min-w-0 truncate text-sm font-semibold">{ref.title}</h2>
        <button type="button" onClick={p.onClose} className="text-xs text-text-faint hover:text-text" aria-label="Close feedback">
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative bg-player" style={{ aspectRatio: aspectOf(ref) }}>
          {motion && playUrl ? (
            <video
              ref={video}
              src={playUrl}
              controls
              playsInline
              preload="metadata"
              className="h-full w-full object-contain"
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onSeeked={(e) => setTime(e.currentTarget.currentTime)}
              data-testid="feedback-video"
            />
          ) : (
            <MotionMedia item={ref} active />
          )}
          {motion && (
            <span className="pointer-events-none absolute top-2 left-2 rounded-xs bg-black/60 px-1.5 timecode text-xs text-white/90" data-testid="feedback-tc">
              {formatTimecode(frame, fps)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
          <button
            type="button"
            onClick={() => void favorite()}
            disabled={!p.canFavorite}
            aria-pressed={p.favorite.mine}
            title={p.canFavorite ? "Favorite" : "This link is view-only"}
            data-testid="favorite"
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs disabled:opacity-50 ${p.favorite.mine ? "border-accent-line bg-accent-soft text-accent" : "border-border-strong text-text-muted hover:text-text"}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.7a4.3 4.3 0 0 1 7.5 2.6c0 5.6-7.5 10.2-7.5 10.2z" fill={p.favorite.mine ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" />
            </svg>
            <span className="tabular" data-testid="favorite-count">
              {p.favorite.count}
            </span>
          </button>
          <span className="ml-auto text-2xs text-text-faint">
            {threads.length} {threads.length === 1 ? "thread" : "threads"}
            {resolvedCount > 0 && (
              <button type="button" className="ml-2 underline-offset-2 hover:underline" onClick={() => setShowResolved((v) => !v)}>
                {showResolved ? "hide" : "show"} {resolvedCount} resolved
              </button>
            )}
          </span>
        </div>
        <ul className="space-y-3 px-3.5 py-3" data-testid="comment-list">
          {threads.map(({ c, replies }) => (
            <li key={c.id} className={`rounded-md border border-border bg-surface-2 p-2.5 ${c.resolvedAt ? "opacity-60" : ""}`} data-testid="comment">
              <div className="mb-1 flex items-center gap-1.5 text-xs">
                <span className="font-medium">{c.authorName}</span>
                {c.authorKind === "guest" && <span className="rounded-xs bg-surface-4 px-1 text-2xs text-text-muted">guest</span>}
                {c.timecode !== null && (
                  <button type="button" onClick={() => seek(c.timecode!)} className="rounded-xs bg-accent-soft px-1 timecode text-2xs text-accent hover:underline" title="Jump to this moment" data-testid="comment-tc">
                    {formatTimecode(secondsToFrame(c.timecode, fps), fps)}
                  </button>
                )}
                <span className="ml-auto text-2xs text-text-faint">{timeAgo(c.createdAt)}</span>
              </div>
              <Body text={c.body} />
              {replies.map((r) => (
                <div key={r.id} className="mt-2 border-l-2 border-border-strong pl-2.5" data-testid="reply">
                  <div className="mb-0.5 text-xs">
                    <span className="font-medium">{r.authorName}</span>
                    {r.authorKind === "guest" && <span className="ml-1 rounded-xs bg-surface-4 px-1 text-2xs text-text-muted">guest</span>}
                    <span className="ml-1.5 text-2xs text-text-faint">{timeAgo(r.createdAt)}</span>
                  </div>
                  <Body text={r.body} />
                </div>
              ))}
              <div className="mt-1.5 flex gap-3 text-2xs text-text-faint">
                {p.canComment && (
                  <button
                    type="button"
                    className="hover:text-text"
                    onClick={() => {
                      setReplyTo(c.id);
                      input.current?.focus();
                    }}
                  >
                    Reply
                  </button>
                )}
                {p.canResolve && (
                  <button type="button" className="hover:text-text" onClick={() => void resolve(c)} data-testid="resolve">
                    {c.resolvedAt ? "Reopen" : "Resolve"}
                  </button>
                )}
              </div>
            </li>
          ))}
          {threads.length === 0 && <li className="py-6 text-center text-xs text-text-faint">No comments yet.</li>}
        </ul>
      </div>
      {p.canComment && (
        <form
          className="shrink-0 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void post();
          }}
        >
          {replyTo && (
            <div className="mb-1.5 flex items-center justify-between text-2xs text-text-muted">
              Replying to {p.comments.find((c) => c.id === replyTo)?.authorName}
              <button type="button" onClick={() => setReplyTo(null)} className="hover:text-text">
                Cancel
              </button>
            </div>
          )}
          <textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void post();
            }}
            rows={3}
            placeholder={replyTo ? "Write a reply" : "Add a comment. Use @name to mention someone."}
            aria-label="Comment"
            className="block w-full resize-none rounded-md border border-border-strong bg-surface-2 px-2.5 py-2 text-sm placeholder:text-text-faint focus:border-accent focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between">
            {motion && !replyTo ? (
              <label className="flex items-center gap-1.5 text-xs text-text-muted">
                <input type="checkbox" checked={attachTc} onChange={(e) => setAttachTc(e.target.checked)} className="accent-[var(--in-accent)]" data-testid="attach-tc" />
                at <span className="timecode">{formatTimecode(frame, fps)}</span>
              </label>
            ) : (
              <span />
            )}
            <Button type="submit" size="sm" variant="primary" disabled={busy || !draft.trim()}>
              {replyTo ? "Reply" : "Comment"}
            </Button>
          </div>
        </form>
      )}
    </aside>
  );
}

"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatTimecode, hostOf, secondsToFrame } from "@innovate/shared";
import { Badges } from "@/components/feedback/BoardSocial";
import { MotionMedia } from "@/components/media/MotionMedia";
import type { RefLite } from "@/lib/boards";

const TYPE_LABEL: Record<string, string> = { video: "Video", gif: "GIF", clip: "Clip", still: "Still", image: "Image" };

export function aspectOf(ref: RefLite | undefined) {
  return ref?.width && ref?.height ? ref.width / ref.height : 16 / 9;
}

export function ReferenceBody({ reference, parentTitle, hovering }: { reference: RefLite | undefined; parentTitle?: string; hovering: boolean }) {
  if (!reference)
    return <div className="grid aspect-video place-items-center text-xs text-text-faint">Missing reference</div>;
  if (reference.type === "link") return <LinkReference reference={reference} />;
  const fps = reference.fps;
  const tc = (s: number | null) => (s === null || !fps ? null : formatTimecode(secondsToFrame(s, fps), fps));
  const range =
    reference.sourceIn !== null && fps
      ? reference.type === "still"
        ? tc(reference.sourceIn)
        : `${tc(reference.sourceIn)} → ${tc(reference.sourceOut! - fps.den / fps.num)}`
      : null;
  const editorHref =
    reference.type === "video"
      ? `/make/${reference.id}`
      : reference.parentReferenceId && fps && reference.sourceIn !== null
        ? `/make/${reference.parentReferenceId}?in=${secondsToFrame(reference.sourceIn, fps)}&out=${Math.max(
            secondsToFrame(reference.sourceIn, fps),
            secondsToFrame(reference.sourceOut ?? reference.sourceIn, fps) - 1,
          )}`
        : null;
  return (
    <>
      <div className="relative bg-player" style={{ aspectRatio: aspectOf(reference) }}>
        <MotionMedia item={reference} active={hovering} />
        {reference.type !== "image" && (
          <span className="absolute top-2 left-2 rounded-xs bg-black/70 px-1.5 py-px text-2xs font-medium text-white/90">{TYPE_LABEL[reference.type] ?? reference.type}</span>
        )}
        {(reference.type === "gif" || reference.type === "clip" || reference.type === "video") && reference.duration ? (
          <span className="absolute right-2 bottom-2 rounded-xs bg-black/70 px-1 font-mono text-2xs text-white/90">{reference.duration.toFixed(1)}s</span>
        ) : null}
        <Badges referenceId={reference.id} />
        {reference.status !== "ready" && (
          <span className="absolute inset-0 grid place-items-center bg-black/55 text-xs text-white/80">
            {reference.status === "failed" ? "Processing failed" : "Processing…"}
          </span>
        )}
      </div>
      <div className="px-2.5 pt-1.5 pb-2">
        <div className="truncate text-sm leading-[18px]">{reference.title}</div>
        <div className="truncate text-2xs text-text-faint">
          {[range, parentTitle ? `from ${parentTitle}` : null].filter(Boolean).join(" · ") || TYPE_LABEL[reference.type]}
          {editorHref && (
            <Link
              href={editorHref}
              onPointerDown={(e) => e.stopPropagation()}
              className="ml-1.5 text-accent hover:underline"
              title={reference.type === "video" ? "Open in the GIF Maker" : "Open the source at this range"}
            >
              {reference.type === "video" ? "Open" : "Source"}
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

/** Plain-text note; double-click (or Enter when focused) to edit. */
export function NoteBody({
  text,
  editing,
  onDone,
}: {
  text: string;
  editing: boolean;
  onDone(next: string | null): void;
}) {
  if (editing) return <NoteEditor text={text} onDone={onDone} />;
  const [first, ...rest] = (text || "").split("\n");
  return (
    <div className="px-3.5 py-3 text-base leading-[19px] whitespace-pre-wrap" data-testid="note-text">
      {text ? (
        <>
          <div className={rest.length ? "mb-1 font-semibold" : ""}>{first}</div>
          {rest.length > 0 && <div className="text-text-muted">{rest.join("\n")}</div>}
        </>
      ) : (
        <span className="text-text-faint">Double-click to write</span>
      )}
    </div>
  );
}

function NoteEditor({ text, onDone }: { text: string; onDone(next: string | null): void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(text);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  {
    return (
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onDone(null);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onDone(draft);
        }}
        onBlur={() => onDone(draft)}
        aria-label="Note text"
        rows={Math.max(3, draft.split("\n").length + 1)}
        className="block w-full resize-none bg-transparent px-3.5 py-3 text-base leading-[19px] outline-none"
      />
    );
  }
}

export function LinkBody({ url, title, host, editing, onDone }: { url?: string; title?: string; host?: string; editing: boolean; onDone(url: string | null): void }) {
  const [draft, setDraft] = useState(url ?? "");
  if (editing || !url)
    return (
      <form
        className="flex gap-2 p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          onDone(draft.trim() || null);
        }}
      >
        <input
          autoFocus
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") onDone(null);
          }}
          placeholder="Paste a link"
          aria-label="Link URL"
          className="h-7 min-w-0 flex-1 rounded-sm border border-border-strong bg-surface-2 px-2 text-sm focus:border-accent focus:outline-none"
        />
      </form>
    );
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.detail < 2 && e.preventDefault()}
      onDoubleClick={() => window.open(url, "_blank", "noopener")}
      className="flex items-center gap-2.5 px-3 py-2.5"
      title="Double-click to open"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-3 text-text-faint">↗</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{title || host}</span>
        <span className="block truncate text-2xs text-text-faint">{host}</span>
      </span>
    </a>
  );
}

export function BoardBody({ title, cover, count }: { title: string; cover: string[]; count: number }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-0.5 bg-surface-2 p-1.5">
        {[0, 1, 2, 3].map((i) =>
          cover[i] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={cover[i]} alt="" draggable={false} className="aspect-[16/10] w-full rounded-xs object-cover" />
          ) : (
            <div key={i} className="aspect-[16/10] rounded-xs bg-surface-3" />
          ),
        )}
      </div>
      <div className="px-2.5 pt-1.5 pb-2">
        <div className="truncate text-sm font-semibold">{title}</div>
        <div className="text-2xs text-text-faint">
          board · {count} {count === 1 ? "item" : "items"}
        </div>
      </div>
    </>
  );
}

/** A saved page: its preview image (og:image, imported by the worker) at native ratio, title and host. */
function LinkReference({ reference }: { reference: RefLite }) {
  const host = reference.sourceUrl ? hostOf(reference.sourceUrl) : "";
  return (
    <>
      {reference.thumbnailUrl && (
        <div className="relative bg-surface-3" style={{ aspectRatio: aspectOf(reference) }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={reference.thumbnailUrl} alt="" loading="lazy" draggable={false} className="block h-full w-full object-cover" />
          <Badges referenceId={reference.id} />
        </div>
      )}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-3 text-text-faint" aria-hidden="true">
          ↗
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{reference.title}</span>
          {reference.sourceUrl ? (
            <a href={reference.sourceUrl} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()} className="block truncate text-2xs text-text-faint hover:text-accent">
              {host}
            </a>
          ) : null}
        </span>
      </div>
    </>
  );
}

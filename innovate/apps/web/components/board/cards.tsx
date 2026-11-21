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

export function ReferenceBody({
  reference,
  parentTitle,
  hovering,
  clean = false,
  boardId,
}: {
  reference: RefLite | undefined;
  parentTitle?: string;
  hovering: boolean;
  clean?: boolean;
  /** The board the card is on: the GIF Maker opened from it saves back to it. */
  boardId?: string;
}) {
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
  const back = boardId ? `board=${boardId}` : "";
  const editorHref =
    reference.type === "video"
      ? `/make/${reference.id}${back ? `?${back}` : ""}`
      : reference.parentReferenceId && fps && reference.sourceIn !== null
        ? `/make/${reference.parentReferenceId}?in=${secondsToFrame(reference.sourceIn, fps)}&out=${Math.max(
            secondsToFrame(reference.sourceIn, fps),
            secondsToFrame(reference.sourceOut ?? reference.sourceIn, fps) - 1,
          )}${back ? `&${back}` : ""}`
        : null;
  if (clean)
    // On a board (Milanote-style): the image itself, full-bleed. Title, range and source show on hover.
    return (
      <div className="group/ref relative bg-player" style={{ aspectRatio: aspectOf(reference) }}>
        <MotionMedia item={reference} active={hovering} />
        <Badges referenceId={reference.id} />
        {reference.status !== "ready" && (
          <span className="absolute inset-0 grid place-items-center bg-black/55 text-xs text-white/80">{reference.status === "failed" ? "Processing failed" : "Processing…"}</span>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-2.5 pt-8 pb-2 text-white opacity-0 transition-opacity duration-150 group-hover/ref:opacity-100 group-focus-within/ref:opacity-100">
          <div className="truncate text-sm font-medium">{reference.title}</div>
          <div className="pointer-events-auto flex items-center gap-1.5 truncate text-2xs text-white/80">
            <span>{[TYPE_LABEL[reference.type], range].filter(Boolean).join(" · ")}</span>
            {editorHref && (
              <Link href={editorHref} onPointerDown={(e) => e.stopPropagation()} className="font-medium text-white underline-offset-2 hover:underline" title={reference.type === "video" ? "Open in the GIF Maker" : "Open the source at this range"}>
                {reference.type === "video" ? "Make GIF" : "Source"}
              </Link>
            )}
          </div>
        </div>
        {(reference.type === "gif" || reference.type === "clip") && reference.duration ? (
          <span className="absolute top-2 right-2 rounded-xs bg-black/55 px-1 font-mono text-2xs text-white/90 opacity-0 group-hover/ref:opacity-100">{reference.duration.toFixed(1)}s</span>
        ) : null}
      </div>
    );
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
              {reference.type === "video" ? "Make GIF" : "Source"}
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

/** Plain-text note; double-click (or Enter when focused) to edit. */
const LABEL_BG: Record<string, string> = {
  green: "bg-label-green",
  brown: "bg-label-brown",
  slate: "bg-label-slate",
  blue: "bg-label-blue",
  red: "bg-label-red",
  ink: "bg-label-ink",
};
/** The colour each note option shows as in the card toolbar. */
export const NOTE_SWATCH_CLASS: Record<string, string> = { white: "bg-surface", yellow: "bg-note-yellow", ...LABEL_BG };

export function NoteBody({
  text,
  editing,
  onDone,
  color = "white",
}: {
  text: string;
  editing: boolean;
  onDone(next: string | null): void;
  color?: string;
}) {
  const label = LABEL_BG[color];
  if (editing)
    return (
      <div className={label ? `${label} text-white` : color === "yellow" ? "bg-note-yellow text-label-ink" : ""}>
        <NoteEditor text={text} onDone={onDone} />
      </div>
    );
  if (label)
    // A label (Milanote-style banner): white serif text on colour, for headings across a board.
    return (
      <div className={`${label} px-4 py-3 text-center font-serif text-[19px] leading-[24px] font-semibold whitespace-pre-wrap text-white`} data-testid="note-text">
        {text || <span className="font-sans text-sm font-normal text-white/70">Double-click to write</span>}
      </div>
    );
  const [first, ...rest] = (text || "").split("\n");
  return (
    <div className={`px-3.5 py-3 text-base leading-[19px] whitespace-pre-wrap ${color === "yellow" ? "bg-note-yellow text-label-ink" : ""}`} data-testid="note-text">
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

/** A colour swatch card: the colour, and its hex code (double-click to change it). */
export function SwatchBody({ hex, editing, onDone }: { hex: string; editing: boolean; onDone(next: string | null): void }) {
  const [draft, setDraft] = useState(hex);
  return (
    <div data-testid="swatch">
      <div className="aspect-square w-full" style={{ backgroundColor: editing && /^#[0-9a-f]{6}$/i.test(draft) ? draft : hex }} />
      {editing ? (
        <form
          className="flex items-center gap-1.5 px-2.5 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            onDone(/^#?[0-9a-f]{6}$/i.test(draft.trim()) ? `#${draft.trim().replace(/^#/, "").toLowerCase()}` : null);
          }}
        >
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(draft) ? draft : hex} onChange={(e) => setDraft(e.target.value)} onPointerDown={(e) => e.stopPropagation()} aria-label="Pick a colour" className="h-6 w-6 shrink-0 cursor-pointer" />
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") onDone(null);
            }}
            onBlur={() => onDone(/^#?[0-9a-f]{6}$/i.test(draft.trim()) ? `#${draft.trim().replace(/^#/, "").toLowerCase()}` : null)}
            aria-label="Colour hex code"
            className="h-6 min-w-0 flex-1 rounded-xs border border-border-strong bg-surface px-1.5 font-mono text-xs uppercase focus:border-accent focus:outline-none"
          />
        </form>
      ) : (
        <div className="px-2.5 py-2 font-mono text-xs text-text-muted uppercase">{hex}</div>
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

const BOARD_COLORS = ["bg-board-1", "bg-board-2", "bg-board-3", "bg-board-4", "bg-board-5", "bg-board-6"];
export function boardColor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BOARD_COLORS[h % BOARD_COLORS.length]!;
}

/** A board card (Milanote-style): a coloured board icon, the title and how many cards are inside. */
export function BoardBody({ title, count }: { title: string; cover?: string[]; count: number }) {
  return (
    <div className="flex flex-col items-center px-2 pt-3 pb-2.5 text-center">
      <div className={`grid h-[72px] w-[72px] place-items-center rounded-lg text-white shadow-[0_1px_2px_rgba(0,0,0,0.15)] ${boardColor(title)}`}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="4" width="7" height="9" rx="1" />
          <rect x="13" y="4" width="7" height="5" rx="1" />
          <rect x="13" y="11" width="7" height="9" rx="1" />
          <rect x="4" y="15" width="7" height="5" rx="1" />
        </svg>
      </div>
      <div className="mt-2 w-full truncate text-base font-semibold">{title}</div>
      <div className="text-xs text-text-faint">
        {count} {count === 1 ? "card" : "cards"}
      </div>
    </div>
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

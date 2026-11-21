"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SLIDE_LAYOUT_LABEL, SLIDE_LAYOUTS, type SlideInput, type SlideLayout } from "@innovate/shared";
import { ShareDialog } from "@/components/feedback/BoardSocial";
import { useToast } from "@/components/ui/Toasts";
import type { RefLite } from "@/lib/boards";
import { download, runJob } from "@/lib/client-jobs";
import type { DeckData } from "@/lib/present";
import { saveLabel, useAutosave } from "@/lib/useAutosave";
import { MediaPicker } from "./MediaPicker";
import { type SlideMedia, SlideView } from "./SlideView";

const MAX_MEDIA: Record<SlideLayout, number> = { title: 1, text: 0, media: 1, "media-text": 2, grid: 6 };

/**
 * Deck editor: slide rail, the slide itself (edit in place), and a panel for layout, media and
 * notes. The whole deck autosaves (debounced PUT); one save is in flight at a time.
 */
export function DeckEditor({ data, boards }: { data: DeckData; boards: { id: string; title: string }[] }) {
  const toast = useToast();
  const deckId = data.deck.id;
  const [title, setTitle] = useState(data.deck.title);
  const [theme, setTheme] = useState<"paper" | "night">(data.deck.theme);
  const [slides, setSlides] = useState<SlideInput[]>(data.slides);
  const [media, setMedia] = useState<Record<string, SlideMedia | undefined>>(data.media);
  const [current, setCurrent] = useState(data.slides[0]?.id ?? null);
  const [slot, setSlot] = useState<number | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const doc = useMemo(() => ({ title, theme, slides }), [title, theme, slides]);
  const { status, save } = useAutosave(`/api/decks/${deckId}`, doc, {
    onSaved: (body) => setMedia((m) => ({ ...m, ...(body as DeckData).media })),
    onError: (m) => toast(m, "error"),
  });

  const idx = Math.max(0, slides.findIndex((s) => s.id === current));
  const slide = slides[idx];
  const patch = (id: string, p: Partial<SlideInput>) => setSlides((cur) => cur.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const addSlide = (layout: SlideLayout) => {
    const s: SlideInput = { id: crypto.randomUUID(), layout, section: "", heading: "", body: "", mediaIds: [], notes: "" };
    setSlides((cur) => [...cur.slice(0, idx + 1), s, ...cur.slice(idx + 1)]);
    setCurrent(s.id);
    setSlot(MAX_MEDIA[layout] ? 0 : null);
  };
  const move = (id: string, by: number) =>
    setSlides((cur) => {
      const i = cur.findIndex((s) => s.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const remove = (id: string) => {
    setSlides((cur) => cur.filter((s) => s.id !== id));
    setCurrent(slides[idx + 1]?.id ?? slides[idx - 1]?.id ?? null);
  };
  const pick = (r: RefLite) => {
    if (!slide) return;
    const max = MAX_MEDIA[slide.layout];
    if (!max) return toast("This layout has no media. Pick another layout first.", "error");
    setMedia((m) => ({ ...m, [r.id]: r }));
    const ids = [...slide.mediaIds];
    const at = slot ?? ids.length;
    if (at < ids.length) ids[at] = r.id;
    else if (ids.length < max) ids.push(r.id);
    else ids[max - 1] = r.id;
    patch(slide.id, { mediaIds: ids.slice(0, max) });
    setSlot(Math.min(at + 1, max - 1));
  };

  const exportPdf = async () => {
    setPdfBusy(true);
    try {
      await save();
      const job = await runJob(`/api/decks/${deckId}/pdf`);
      if (job.downloadUrl) download(job.downloadUrl, job.output?.filename ?? "deck.pdf");
      toast("PDF ready", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setPdfBusy(false);
    }
  };

  // Alt+↑/↓ reorders the current slide (like shot lists).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !slide || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      move(slide.id, e.key === "ArrowUp" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slide]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link href="/decks" className="text-sm text-text-muted hover:text-text">
          Decks
        </Link>
        <span className="text-text-faint">/</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Deck title" data-testid="deck-title" className="h-8 min-w-0 flex-1 rounded-md bg-transparent px-1 text-md font-medium hover:bg-surface-2 focus:bg-surface-2 focus:outline-none" />
        <span className="text-xs text-text-faint" data-testid="save-status" role="status">
          {saveLabel(status)}
        </span>
        <div className="flex rounded-md border border-border p-0.5 text-sm" role="group" aria-label="Deck theme">
          {(["paper", "night"] as const).map((t) => (
            <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)} className={`rounded-sm px-2 py-0.5 capitalize ${theme === t ? "bg-surface-3 text-text" : "text-text-muted"}`}>
              {t}
            </button>
          ))}
        </div>
        <ShareDialog boardId={deckId} endpoint={`/api/decks/${deckId}/shares`} viewOnly noun="deck" onError={(m) => toast(m, "error")} />
        <button type="button" onClick={exportPdf} disabled={pdfBusy} className="h-8 rounded-md border border-border px-3 text-sm hover:bg-surface-2 disabled:opacity-60">
          {pdfBusy ? "Rendering…" : "PDF"}
        </button>
        <Link
          href={`/decks/${deckId}/present#slide-${idx + 1}`}
          onClick={() => void save()}
          className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-strong"
        >
          Present
        </Link>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr_300px]">
        {/* Slide rail */}
        <div className="flex min-h-0 flex-col border-r border-border">
          <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" aria-label="Slides">
            {slides.map((s, i) => (
              <li key={s.id} className="group relative">
                <button
                  type="button"
                  onClick={() => {
                    setCurrent(s.id);
                    setSlot(null);
                  }}
                  aria-label={`Slide ${i + 1}${s.heading ? `: ${s.heading}` : ""}`}
                  aria-current={s.id === slide?.id ? "true" : undefined}
                  className={`block w-full overflow-hidden rounded-sm border text-left ${s.id === slide?.id ? "border-accent ring-1 ring-accent" : "border-border hover:border-border-strong"}`}
                  data-testid="slide-thumb"
                >
                  <div className="pointer-events-none">
                    <SlideView slide={s} media={media} theme={theme} deckTitle={title} playing={false} />
                  </div>
                </button>
                <span className="absolute top-1 -left-2.5 font-mono text-2xs text-text-faint">{i + 1}</span>
              </li>
            ))}
          </ol>
          <div className="border-t border-border p-2">
            <label className="sr-only" htmlFor="add-slide">
              Add slide
            </label>
            <select
              id="add-slide"
              value=""
              onChange={(e) => e.target.value && addSlide(e.target.value as SlideLayout)}
              className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-sm"
            >
              <option value="">+ Add slide…</option>
              {SLIDE_LAYOUTS.map((l) => (
                <option key={l} value={l}>
                  {SLIDE_LAYOUT_LABEL[l]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* The slide */}
        <div className="min-h-0 overflow-y-auto bg-surface-3 p-8">
          {slide ? (
            <div className="mx-auto max-w-[1100px] shadow-lg" data-testid="slide-editor">
              <SlideView
                key={slide.id}
                slide={slide}
                media={media}
                theme={theme}
                deckTitle={title}
                playing
                edit={{ onChange: (p) => patch(slide.id, p), onSlotClick: (i) => setSlot(i), activeSlot: slot }}
              />
            </div>
          ) : (
            <p className="text-center text-sm text-text-muted">No slides. Add one from the bottom of the rail.</p>
          )}
        </div>

        {/* Inspector */}
        <div className="flex min-h-0 flex-col border-l border-border">
          {slide && (
            <div className="space-y-3 border-b border-border p-3">
              <label className="block text-xs text-text-muted">
                Layout
                <select value={slide.layout} onChange={(e) => patch(slide.id, { layout: e.target.value as SlideLayout, mediaIds: slide.mediaIds.slice(0, MAX_MEDIA[e.target.value as SlideLayout]) })} className="mt-1 h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-text">
                  {SLIDE_LAYOUTS.map((l) => (
                    <option key={l} value={l}>
                      {SLIDE_LAYOUT_LABEL[l]}
                    </option>
                  ))}
                </select>
              </label>
              {slot !== null && slide.mediaIds[slot] && (
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate text-text-muted">Media {slot + 1}: {media[slide.mediaIds[slot]!]?.title}</span>
                  <button type="button" className="text-danger hover:underline" onClick={() => patch(slide.id, { mediaIds: slide.mediaIds.filter((_, i) => i !== slot) })}>
                    Remove
                  </button>
                </div>
              )}
              <div className="flex gap-1.5 text-xs">
                <button type="button" onClick={() => move(slide.id, -1)} disabled={idx === 0} className="h-7 rounded-sm border border-border px-2 disabled:opacity-40" aria-label="Move slide up">
                  ↑ Up
                </button>
                <button type="button" onClick={() => move(slide.id, 1)} disabled={idx === slides.length - 1} className="h-7 rounded-sm border border-border px-2 disabled:opacity-40" aria-label="Move slide down">
                  ↓ Down
                </button>
                <button type="button" onClick={() => remove(slide.id)} className="ml-auto h-7 rounded-sm px-2 text-danger hover:bg-surface-2">
                  Delete slide
                </button>
              </div>
              <label className="block text-xs text-text-muted">
                Speaker notes
                <textarea value={slide.notes} onChange={(e) => patch(slide.id, { notes: e.target.value })} rows={3} className="mt-1 w-full resize-y rounded-md border border-border bg-surface-2 p-2 text-sm text-text" />
              </label>
            </div>
          )}
          <div className="px-3 pt-3 text-xs font-medium tracking-[0.08em] text-text-faint uppercase">
            {slide && MAX_MEDIA[slide.layout] ? (slot !== null ? `Pick for media ${slot + 1}` : "Add to this slide") : "References"}
          </div>
          <MediaPicker boardId={data.deck.boardId} boards={boards} accept={(r) => r.type !== "link" && r.type !== "note"} onPick={pick} />
        </div>
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import { PORTFOLIO_TEMPLATE_LABEL, PORTFOLIO_TEMPLATES } from "@innovate/shared";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toasts";
import type { RefLite } from "@/lib/boards";
import type { Playable, PortfolioData } from "@/lib/present";
import { MediaPicker } from "./MediaPicker";
import { PortfolioView } from "./PortfolioView";

type Item = PortfolioData["items"][number];
type Template = (typeof PORTFOLIO_TEMPLATES)[number];

/** Edit the workspace's public portfolio page; the preview below is the page itself. */
export function PortfolioEditor({
  initial,
  suggestedSlug,
  reels,
  boards,
  origin,
}: {
  initial: PortfolioData | null;
  suggestedSlug: string;
  reels: { id: string; title: string }[];
  boards: { id: string; title: string }[];
  origin: string;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    slug: initial?.portfolio.slug ?? suggestedSlug,
    title: initial?.portfolio.title ?? "",
    bio: initial?.portfolio.bio ?? "",
    contactEmail: initial?.portfolio.contactEmail ?? "",
    website: initial?.portfolio.website ?? "",
    template: (initial?.portfolio.template ?? "grid") as Template,
    published: initial?.portfolio.published ?? false,
  });
  const [items, setItems] = useState<Item[]>(initial?.items ?? []);
  const [media, setMedia] = useState<Record<string, Playable>>(initial?.media ?? {});
  const [reelData, setReelData] = useState<PortfolioData["reels"]>(initial?.reels ?? {});
  const [saving, setSaving] = useState(false);
  const [savedSlug, setSavedSlug] = useState(initial?.portfolio.published ? initial.portfolio.slug : null);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const addRef = (r: RefLite) => {
    if (items.some((i) => i.referenceId === r.id)) return toast("That's already on the page.", "info");
    setMedia((m) => ({ ...m, [r.id]: { ...r, playUrl: null } }));
    setItems((cur) => [...cur, { id: crypto.randomUUID(), referenceId: r.id, reelId: null, caption: "" }]);
  };
  const addReel = (id: string) => {
    if (!id || items.some((i) => i.reelId === id)) return;
    setItems((cur) => [...cur, { id: crypto.randomUUID(), referenceId: null, reelId: id, caption: "" }]);
  };
  const move = (id: string, by: number) =>
    setItems((cur) => {
      const i = cur.findIndex((x) => x.id === id);
      const j = i + by;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/portfolio", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, items: items.map((i) => ({ referenceId: i.referenceId, reelId: i.reelId, caption: i.caption })) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't save the portfolio.");
      const p = body.portfolio as PortfolioData;
      setItems(p.items);
      setMedia(p.media);
      setReelData(p.reels);
      setSavedSlug(p.portfolio.published ? p.portfolio.slug : null);
      toast(p.portfolio.published ? "Published" : "Saved (not published)", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const input = "mt-1 h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-text";
  return (
    <div className="grid h-full grid-cols-[380px_1fr_280px]">
      <div className="min-h-0 space-y-4 overflow-y-auto border-r border-border p-5">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.01em]">Portfolio</h1>
          <p className="text-sm text-text-muted">A public page for your work, at your own address.</p>
        </div>
        <label className="block text-xs text-text-muted">
          Address
          <div className="mt-1 flex items-center rounded-md border border-border bg-surface-2 pl-2 text-sm">
            <span className="text-text-faint">{origin.replace(/^https?:\/\//, "")}/p/</span>
            <input value={form.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} aria-label="Portfolio address" className="h-8 min-w-0 flex-1 bg-transparent pr-2 text-text outline-none" />
          </div>
        </label>
        <label className="block text-xs text-text-muted">
          Name or title
          <input value={form.title} onChange={(e) => set("title", e.target.value)} aria-label="Portfolio title" className={input} />
        </label>
        <label className="block text-xs text-text-muted">
          Bio
          <textarea value={form.bio} onChange={(e) => set("bio", e.target.value)} rows={4} aria-label="Bio" className="mt-1 w-full resize-y rounded-md border border-border bg-surface-2 p-2 text-sm text-text" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-text-muted">
            Contact email
            <input type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} aria-label="Contact email" className={input} />
          </label>
          <label className="block text-xs text-text-muted">
            Website
            <input type="url" value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" aria-label="Website" className={input} />
          </label>
        </div>
        <fieldset>
          <legend className="text-xs text-text-muted">Layout</legend>
          <div className="mt-1 flex gap-1.5">
            {PORTFOLIO_TEMPLATES.map((t) => (
              <button key={t} type="button" aria-pressed={form.template === t} onClick={() => set("template", t)} className={`h-8 flex-1 rounded-md border px-2 text-xs ${form.template === t ? "border-accent bg-accent-soft text-text" : "border-border text-text-muted"}`}>
                {PORTFOLIO_TEMPLATE_LABEL[t].split(" (")[0]}
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
            <span>On the page ({items.length})</span>
            <select value="" onChange={(e) => addReel(e.target.value)} aria-label="Add a reel" className="h-7 rounded-md border border-border bg-surface-2 px-1.5 text-xs">
              <option value="">+ Add a reel…</option>
              {reels.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </div>
          <ol className="space-y-1.5">
            {items.map((i, n) => {
              const name = i.reelId ? `Reel: ${reels.find((r) => r.id === i.reelId)?.title ?? "reel"}` : (media[i.referenceId!]?.title ?? "Reference");
              return (
                <li key={i.id} className="rounded-md border border-border bg-surface p-2" data-testid="portfolio-row">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className="w-4 font-mono text-2xs text-text-faint">{n + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <button type="button" onClick={() => move(i.id, -1)} aria-label={`Move ${name} up`} className="px-1 text-text-muted hover:text-text">↑</button>
                    <button type="button" onClick={() => move(i.id, 1)} aria-label={`Move ${name} down`} className="px-1 text-text-muted hover:text-text">↓</button>
                    <button type="button" onClick={() => setItems((cur) => cur.filter((x) => x.id !== i.id))} aria-label={`Remove ${name}`} className="px-1 text-danger">×</button>
                  </div>
                  <input value={i.caption} onChange={(e) => setItems((cur) => cur.map((x) => (x.id === i.id ? { ...x, caption: e.target.value } : x)))} placeholder="Caption (optional)" aria-label={`Caption for ${name}`} className="mt-1 h-7 w-full rounded-sm border border-border bg-surface-2 px-2 text-xs" />
                </li>
              );
            })}
          </ol>
        </div>

        <div className="sticky bottom-0 -mx-5 space-y-2 border-t border-border bg-bg px-5 py-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.published} onChange={(e) => set("published", e.target.checked)} />
            Published (anyone with the address can see it)
          </label>
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : form.published ? "Save and publish" : "Save"}
            </Button>
            {savedSlug && (
              <a href={`/p/${savedSlug}`} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline" data-testid="portfolio-public-link">
                View page ↗
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto bg-surface-3 p-6">
        <div className="mb-2 text-xs font-medium tracking-[0.08em] text-text-faint uppercase">Preview</div>
        <div className="overflow-hidden rounded-md border border-border shadow-lg">
          <PortfolioView data={{ portfolio: { id: "", ...form }, items, media, reels: reelData }} />
        </div>
      </div>

      <div className="flex min-h-0 flex-col border-l border-border">
        <div className="px-3 pt-3 text-xs font-medium tracking-[0.08em] text-text-faint uppercase">Add work</div>
        <MediaPicker boards={boards} accept={(r) => r.type !== "link" && r.type !== "note"} onPick={addRef} label="Add to portfolio:" />
      </div>
    </div>
  );
}

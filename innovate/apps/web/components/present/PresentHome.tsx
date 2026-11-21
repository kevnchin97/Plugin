"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MotionMedia } from "@/components/media/MotionMedia";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toasts";
import type { Playable } from "@/lib/present";

interface Item {
  id: string;
  title: string;
  updatedAt: string;
  count: number;
  cover: Playable | null;
}

/** Decks and reels home: cover cards plus a "new" control (decks: template + board to draft from). */
export function PresentHome({ kind, items, boards }: { kind: "deck" | "reel"; items: Item[]; boards: { id: string; title: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [board, setBoard] = useState("");
  const [template, setTemplate] = useState<"treatment" | "blank">("treatment");
  const [hover, setHover] = useState<string | null>(null);
  const plural = kind === "deck" ? "decks" : "reels";
  const create = async () => {
    const body =
      kind === "deck"
        ? { title: board ? `${boards.find((b) => b.id === board)?.title ?? "Untitled"}: treatment` : "Untitled treatment", template, boardId: board || null }
        : { title: "Untitled reel" };
    const res = await fetch(`/api/${plural}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return toast(`Couldn't create a ${kind}.`, "error");
    const json = await res.json();
    router.push(`/${plural}/${(json.deck ?? json.reel).id}`);
  };
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1200px] px-6 py-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.01em]">{kind === "deck" ? "Decks" : "Reels"}</h1>
            <p className="text-sm text-text-muted">
              {kind === "deck" ? "Treatments and pitch decks with moving references. Present full screen or share a link." : "Your best clips in order, trimmed, with title and end cards. Publish a clean player link."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {kind === "deck" && (
              <>
                <select value={template} onChange={(e) => setTemplate(e.target.value as "treatment" | "blank")} aria-label="Template" className="h-8 rounded-md border border-border-strong bg-surface px-2 text-sm">
                  <option value="treatment">Treatment template</option>
                  <option value="blank">Blank</option>
                </select>
                <select value={board} onChange={(e) => setBoard(e.target.value)} aria-label="Draft from board" className="h-8 rounded-md border border-border-strong bg-surface px-2 text-sm">
                  <option value="">No board</option>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      From: {b.title}
                    </option>
                  ))}
                </select>
              </>
            )}
            <Button variant="primary" onClick={() => void create()}>
              New {kind}
            </Button>
          </div>
        </div>
        {items.length ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {items.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/${plural}/${d.id}`}
                  onMouseEnter={() => setHover(d.id)}
                  onMouseLeave={() => setHover(null)}
                  className="block overflow-hidden rounded-md border border-border bg-surface hover:border-border-strong"
                  data-testid={`${kind}-link`}
                >
                  <div className="aspect-video bg-player">{d.cover && <MotionMedia item={d.cover} active={hover === d.id} fit="cover" />}</div>
                  <div className="px-3 py-2">
                    <div className="truncate font-medium">{d.title}</div>
                    <div className="text-xs text-text-faint tabular">
                      {d.count} {kind === "deck" ? (d.count === 1 ? "slide" : "slides") : d.count === 1 ? "clip" : "clips"} · {new Date(d.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid min-h-[240px] place-items-center rounded-lg border border-dashed border-border-strong text-center text-sm text-text-muted">No {plural} yet.</div>
        )}
      </div>
    </div>
  );
}

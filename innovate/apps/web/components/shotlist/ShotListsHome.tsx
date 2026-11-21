"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toasts";

export function ShotListsHome({ lists, boards }: { lists: { id: string; title: string; updatedAt: string; count: number }[]; boards: { id: string; title: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [board, setBoard] = useState("");
  const create = async () => {
    const res = await fetch("/api/shotlists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Untitled shot list", boardId: board || null }) });
    if (!res.ok) return toast("Couldn't create a shot list.", "error");
    router.push(`/shotlists/${(await res.json()).shotList.id}`);
  };
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1000px] px-6 py-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.01em]">Shot lists</h1>
            <p className="text-sm text-text-muted">Plan the shoot shot by shot, with a motion reference for each.</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={board} onChange={(e) => setBoard(e.target.value)} aria-label="Plan from board" className="h-8 rounded-md border border-border-strong bg-surface px-2 text-sm">
              <option value="">No board</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  From: {b.title}
                </option>
              ))}
            </select>
            <Button variant="primary" onClick={() => void create()}>
              New shot list
            </Button>
          </div>
        </div>
        {lists.length ? (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
            {lists.map((l) => (
              <li key={l.id}>
                <Link href={`/shotlists/${l.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-surface-2" data-testid="shotlist-link">
                  <span className="font-medium">{l.title}</span>
                  <span className="text-xs text-text-faint tabular">
                    {l.count} shots · {new Date(l.updatedAt).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid min-h-[240px] place-items-center rounded-lg border border-dashed border-border-strong text-center text-sm text-text-muted">No shot lists yet.</div>
        )}
      </div>
    </div>
  );
}

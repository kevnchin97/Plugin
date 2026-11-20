"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BoardBody } from "@/components/board/cards";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toasts";
import type { BoardsList } from "@/lib/boards";

function BoardTile({ b }: { b: BoardsList["top"][number] }) {
  return (
    <Link href={`/boards/${b.id}`} className="block overflow-hidden rounded-md border border-border bg-surface shadow-[0_1px_2px_rgba(33,29,24,0.06)] hover:border-border-strong" data-testid="board-tile">
      <BoardBody title={b.title} cover={b.cover} count={b.count} />
    </Link>
  );
}

export function BoardsHome({ list }: { list: BoardsList }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    const res = await fetch("/api/boards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Untitled board" }) });
    setBusy(false);
    if (!res.ok) return toast("Couldn't create a board.", "error");
    const { board } = await res.json();
    router.push(`/boards/${board.id}`);
  };
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.01em]">Boards</h1>
            <p className="text-sm text-text-muted">Organize references by project, idea or theme.</p>
          </div>
          <Button variant="primary" onClick={() => void create()} disabled={busy}>
            New board
          </Button>
        </div>
        {list.recent.length > 0 && (
          <section className="mb-8" aria-label="Recently opened">
            <h2 className="mb-3 text-2xs font-medium tracking-[0.12em] text-text-faint uppercase">Recently opened</h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {list.recent.map((b) => (
                <li key={b.id}>
                  <BoardTile b={b} />
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-label="All boards">
          <h2 className="mb-3 text-2xs font-medium tracking-[0.12em] text-text-faint uppercase">All boards</h2>
          {list.top.length ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {list.top.map((b) => (
                <li key={b.id}>
                  <BoardTile b={b} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid min-h-[280px] place-items-center rounded-lg border border-dashed border-border-strong text-center">
              <div>
                <p className="text-md">No boards yet.</p>
                <p className="mt-1 text-sm text-text-muted">A board is a canvas for one project: references, notes, columns and links.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

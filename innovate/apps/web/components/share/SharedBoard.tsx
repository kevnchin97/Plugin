"use client";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { canComment, canFavorite, type SharePermission } from "@innovate/shared";
import { BoardBody, LinkBody, NoteBody, ReferenceBody } from "@/components/board/cards";
import { FeedbackContext, Presence } from "@/components/feedback/BoardSocial";
import { FeedbackPanel } from "@/components/feedback/FeedbackPanel";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { useToast } from "@/components/ui/Toasts";
import type { BoardData, BoardItemDTO } from "@/lib/boards";
import type { CommentDTO, FeedbackData } from "@/lib/feedback";
import { useRealtime } from "@/lib/useRealtime";

const ACCESS: Record<SharePermission, string> = {
  view: "You can view",
  favorite: "You can view and favorite",
  comment: "You can view, favorite and comment",
};

interface Props {
  token: string;
  rootBoardId: string;
  data: BoardData;
  initialFeedback: FeedbackData;
  permission: SharePermission;
  guest: { id: string; name: string } | null;
}

/** What a guest sees: the board as a clean, read-only masonry, grouped by column, with feedback. */
export function SharedBoard({ token, rootBoardId, data, initialFeedback, permission, guest: initialGuest }: Props) {
  const toast = useToast();
  const router = useRouter();
  const [guest, setGuest] = useState(initialGuest);
  const [feedback, setFeedback] = useState(initialFeedback);
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [name, setName] = useState("");
  const nameResolver = useRef<((ok: boolean) => void) | null>(null);
  const boardId = data.board.id;

  const items = data.items;
  const columns = items.filter((i) => i.kind === "column").sort((a, b) => a.x - b.x || a.y - b.y);
  const loose = items.filter((i) => !i.columnId && i.kind !== "column" && i.kind !== "arrow").sort((a, b) => a.y - b.y || a.x - b.x);
  const sections = [
    ...columns.map((c) => ({ id: c.id, title: c.content.title || "Untitled column", items: items.filter((i) => i.columnId === c.id).sort((a, b) => a.position - b.position) })),
    { id: "loose", title: columns.length ? "More" : "", items: loose },
  ].filter((s) => s.items.length);
  const trail = data.breadcrumbs.slice(data.breadcrumbs.findIndex((b) => b.id === rootBoardId));

  const upsert = useCallback((c: CommentDTO) => setFeedback((f) => ({ ...f, comments: [...f.comments.filter((x) => x.id !== c.id), c] })), []);
  const onEvent = useCallback(
    (e: { type: string; [k: string]: unknown }) => {
      if (e.type === "comment" || e.type === "comment-updated") upsert(e.comment as CommentDTO);
      else if (e.type === "favorite") {
        const ev = e as unknown as { referenceId: string; count: number };
        setFeedback((f) => ({ ...f, favorites: { ...f.favorites, [ev.referenceId]: { count: ev.count, mine: f.favorites[ev.referenceId]?.mine ?? false } } }));
      } else if (e.type === "ops") router.refresh();
    },
    [router, upsert],
  );
  const ticketUrl = useMemo(() => `/api/s/${token}/ticket?boardId=${boardId}&g=${guest?.id ?? ""}`, [token, boardId, guest?.id]);
  const { members } = useRealtime(ticketUrl, onEvent);

  const counts = useMemo(() => {
    const out: Record<string, { comments: number; favorites: number }> = {};
    for (const c of feedback.comments) if (!c.resolvedAt) (out[c.referenceId] ??= { comments: 0, favorites: 0 }).comments++;
    for (const [r, f] of Object.entries(feedback.favorites)) (out[r] ??= { comments: 0, favorites: 0 }).favorites = f.count;
    return out;
  }, [feedback]);
  const ctx = useMemo(() => ({ counts, open: (id: string) => setOpen(id) }), [counts]);

  const ensureName = useCallback(async () => {
    if (guest) return true;
    setAsking(true);
    return new Promise<boolean>((resolve) => (nameResolver.current = resolve));
  }, [guest]);

  const saveName = async () => {
    const res = await fetch(`/api/s/${token}/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(json.error ?? "Couldn't save your name.", "error");
      return;
    }
    setGuest(json.guest);
    setAsking(false);
    nameResolver.current?.(true);
  };

  const body = (it: BoardItemDTO) =>
    it.kind === "reference" ? (
      <ReferenceBody reference={it.referenceId ? data.references[it.referenceId] : undefined} parentTitle={undefined} hovering={hover === it.id} />
    ) : it.kind === "note" ? (
      <NoteBody text={it.content.text ?? ""} editing={false} onDone={() => {}} />
    ) : it.kind === "link" ? (
      <LinkBody url={it.content.url} title={it.content.title} host={it.content.host} editing={false} onDone={() => {}} />
    ) : it.kind === "board" && it.childBoardId ? (
      <Link href={`/s/${token}?board=${it.childBoardId}`} className="block">
        <BoardBody title={data.childBoards[it.childBoardId]?.title ?? "Board"} cover={data.childBoards[it.childBoardId]?.cover ?? []} count={data.childBoards[it.childBoardId]?.count ?? 0} />
      </Link>
    ) : null;

  const openRef = open ? data.references[open] : undefined;

  return (
    <FeedbackContext.Provider value={ctx}>
      <div className="flex h-full flex-col">
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
          <span className="text-text">
            <Logo />
          </span>
          <nav aria-label="Breadcrumbs" className="flex min-w-0 items-center gap-1.5 text-sm">
            {trail.map((b, i) => (
              <span key={b.id} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <span className="text-text-faint">/</span>}
                {i < trail.length - 1 ? (
                  <Link href={b.id === rootBoardId ? `/s/${token}` : `/s/${token}?board=${b.id}`} className="truncate text-text-faint hover:text-text">
                    {b.title}
                  </Link>
                ) : (
                  <h1 className="truncate font-medium" data-testid="shared-title">
                    {b.title}
                  </h1>
                )}
              </span>
            ))}
          </nav>
          <span className="hidden text-xs text-text-faint md:inline">{ACCESS[permission]}</span>
          <div className="ml-auto flex items-center gap-3">
            <Presence members={members} selfId={guest?.id} />
            {guest ? (
              <span className="text-xs text-text-muted" data-testid="guest-name">
                Commenting as <b className="font-medium text-text">{guest.name}</b>
              </span>
            ) : (
              canFavorite(permission) && (
                <Button size="sm" variant="ghost" onClick={() => void ensureName()}>
                  Add your name
                </Button>
              )
            )}
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1500px] px-6 py-6">
              {sections.map((s) => (
                <section key={s.id} className="mb-8">
                  {s.title && <h2 className="mb-3 text-sm font-semibold">{s.title}</h2>}
                  <ul className="columns-[240px] gap-3">
                    {s.items.map((it) => (
                      <li key={it.id} className="mb-3 break-inside-avoid">
                        <div
                          role={it.kind === "reference" ? "button" : undefined}
                          tabIndex={it.kind === "reference" ? 0 : undefined}
                          aria-label={it.kind === "reference" ? `Open ${data.references[it.referenceId ?? ""]?.title ?? "reference"}` : undefined}
                          onClick={() => it.kind === "reference" && it.referenceId && setOpen(it.referenceId)}
                          onKeyDown={(e) => e.key === "Enter" && it.kind === "reference" && it.referenceId && setOpen(it.referenceId)}
                          onMouseEnter={() => setHover(it.id)}
                          onMouseLeave={() => setHover(null)}
                          className={`overflow-hidden rounded-md border bg-surface shadow-[0_1px_2px_rgba(33,29,24,0.06)] ${open && open === it.referenceId ? "border-accent" : "border-border"} ${it.kind === "reference" ? "cursor-pointer" : ""}`}
                          data-testid="shared-card"
                          data-kind={it.kind}
                        >
                          {body(it)}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {sections.length === 0 && <p className="py-20 text-center text-text-muted">This board is empty.</p>}
            </div>
          </div>
          {openRef && (
            <FeedbackPanel
              key={openRef.id}
              reference={openRef}
              comments={feedback.comments.filter((c) => c.referenceId === openRef.id)}
              favorite={feedback.favorites[openRef.id] ?? { count: 0, mine: false }}
              api={{ feedbackUrl: `/api/s/${token}/feedback`, mediaUrl: `/api/s/${token}/media/${openRef.id}?boardId=${boardId}`, extra: { boardId } }}
              canFavorite={canFavorite(permission)}
              canComment={canComment(permission)}
              canResolve={false}
              ensureName={ensureName}
              onClose={() => setOpen(null)}
              onFavorite={(r) => setFeedback((f) => ({ ...f, favorites: { ...f.favorites, [openRef.id]: { count: r.count, mine: r.on } } }))}
              onComment={upsert}
              onError={(m) => toast(m, "error")}
            />
          )}
        </div>
      </div>
      <Dialog.Root
        open={asking}
        onOpenChange={(v) => {
          if (!v) {
            setAsking(false);
            nameResolver.current?.(false);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
          <Dialog.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 z-50 w-[min(360px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-strong bg-surface p-5 focus:outline-none">
            <Dialog.Title className="text-lg font-semibold">What should we call you?</Dialog.Title>
            <p className="mt-1 text-sm text-text-muted">Your name shows next to your favorites and comments. No account needed.</p>
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) void saveName();
              }}
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Your name"
                placeholder="Your name"
                className="h-8 min-w-0 flex-1 rounded-md border border-border-strong bg-surface-2 px-2.5 text-sm focus:border-accent focus:outline-none"
              />
              <Button type="submit" size="sm" variant="primary" disabled={!name.trim()}>
                Continue
              </Button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </FeedbackContext.Provider>
  );
}

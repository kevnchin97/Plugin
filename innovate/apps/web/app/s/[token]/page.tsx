import type { Metadata } from "next";
import { headers } from "next/headers";
import { z } from "zod";
import { rateLimit } from "@innovate/shared/realtime";
import { SharedBoard } from "@/components/share/SharedBoard";
import { SharePassword } from "@/components/share/SharePassword";
import { Logo } from "@/components/ui/Logo";
import { ToastProvider } from "@/components/ui/Toasts";
import { loadBoard } from "@/lib/boards";
import { boardInShare, loadFeedback, resolveShare } from "@/lib/feedback";

export const metadata: Metadata = { title: "Shared board", robots: { index: false } };

function Message({ title, body }: { title: string; body: string }) {
  return (
    <main className="grid min-h-full place-items-center px-6">
      <div className="max-w-[360px] text-center">
        <div className="mb-8 inline-block text-text">
          <Logo />
        </div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-text-muted">{body}</p>
      </div>
    </main>
  );
}

/** Public share link: no login. Rate-limited, password-gated if set, scoped to the shared board tree. */
export default async function SharePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ board?: string }> }) {
  const { token } = await params;
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "local";
  if (!(await rateLimit(`share-page:${token}:${ip}`, 120, 60))) return <Message title="Slow down" body="Too many requests for this link. Try again in a minute." />;

  const share = await resolveShare(token);
  if (!share.ok)
    return (
      <Message
        title={share.reason === "expired" ? "This link has expired" : share.reason === "revoked" ? "This link was turned off" : "Link not found"}
        body={share.reason === "missing" ? "Check the address, or ask whoever sent it for a new one." : "Ask whoever shared it for a new link."}
      />
    );
  if (!share.unlocked) return <SharePassword token={token} />;

  const requested = z.uuid().safeParse((await searchParams).board);
  const boardId = requested.success ? requested.data : share.link.targetId;
  if (!(await boardInShare(share.link, boardId))) return <Message title="Not part of this link" body="That board isn't included in what was shared with you." />;

  const [data, feedback] = await Promise.all([
    loadBoard(share.link.workspaceId, boardId, null),
    loadFeedback(share.link.workspaceId, boardId, { guestId: share.guest?.id }),
  ]);
  return (
    <ToastProvider>
      <SharedBoard
        key={boardId}
        token={token}
        rootBoardId={share.link.targetId}
        data={data}
        initialFeedback={feedback}
        permission={share.link.permission}
        guest={share.guest}
      />
    </ToastProvider>
  );
}

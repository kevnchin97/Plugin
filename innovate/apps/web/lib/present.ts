import "server-only";
import {
  and,
  asc,
  boardItems,
  decks,
  desc,
  eq,
  inArray,
  notInArray,
  portfolioItems,
  portfolios,
  type Reference,
  reelItems,
  reels,
  references,
  slides,
  sql,
} from "@innovate/db";
import { type SaveDeck, type SavePortfolio, type SaveReel, TREATMENT_TEMPLATE } from "@innovate/shared";
import { HttpError, notFound } from "./api";
import { getBoard, serializeRefLite } from "./boards";
import { db, storage } from "./server";

/* ---------- shared ---------- */

/** RefLite plus a playable URL for videos (the proxy) and clips (the file), for decks and reels. */
export async function serializePlayable(ref: Reference) {
  const s = storage();
  const playKey = ref.type === "video" ? ref.proxyKey : ref.type === "clip" ? ref.originalKey : null;
  return { ...(await serializeRefLite(ref)), playUrl: playKey ? await s.signedGetUrl(playKey, { expiresIn: 6 * 3600 }) : null };
}
export type Playable = Awaited<ReturnType<typeof serializePlayable>>;

async function playables(workspaceId: string, ids: string[]) {
  const want = [...new Set(ids)];
  if (!want.length) return {} as Record<string, Playable>;
  const rows = await db().select().from(references).where(and(eq(references.workspaceId, workspaceId), inArray(references.id, want)));
  return Object.fromEntries(await Promise.all(rows.map(async (r) => [r.id, await serializePlayable(r)] as const))) as Record<string, Playable>;
}

async function assertRefs(workspaceId: string, ids: string[]) {
  const want = [...new Set(ids)];
  if (!want.length) return;
  const rows = await db().select({ id: references.id }).from(references).where(and(eq(references.workspaceId, workspaceId), inArray(references.id, want)));
  if (rows.length !== want.length) throw new HttpError(400, "Some of those references aren't in this workspace any more.");
}

/* ---------- decks ---------- */

export async function getDeck(workspaceId: string, id: string) {
  const [deck] = await db().select().from(decks).where(and(eq(decks.id, id), eq(decks.workspaceId, workspaceId)));
  if (!deck) throw notFound("That deck doesn't exist in this workspace.");
  return deck;
}

export async function loadDeck(workspaceId: string, id: string) {
  const deck = await getDeck(workspaceId, id);
  const rows = await db().select().from(slides).where(eq(slides.deckId, id)).orderBy(asc(slides.position), asc(slides.createdAt));
  return {
    deck: { id: deck.id, title: deck.title, theme: deck.theme, boardId: deck.boardId, updatedAt: deck.updatedAt.toISOString() },
    slides: rows.map((s) => ({ id: s.id, layout: s.layout, section: s.section, heading: s.heading, body: s.body, mediaIds: s.mediaIds, notes: s.notes })),
    media: await playables(workspaceId, rows.flatMap((s) => s.mediaIds)),
  };
}
export type DeckData = Awaited<ReturnType<typeof loadDeck>>;

export async function listDecks(workspaceId: string) {
  const rows = await db()
    .select({
      id: decks.id,
      title: decks.title,
      theme: decks.theme,
      updatedAt: decks.updatedAt,
      count: sql<number>`(select count(*)::int from slides s where s.deck_id = ${decks.id})`,
      cover: sql<string | null>`(select s.media_ids->>0 from slides s where s.deck_id = ${decks.id} and jsonb_array_length(s.media_ids) > 0 order by s.position limit 1)`,
    })
    .from(decks)
    .where(eq(decks.workspaceId, workspaceId))
    .orderBy(desc(decks.updatedAt));
  const covers = await playables(workspaceId, rows.map((r) => r.cover).filter((x): x is string => Boolean(x)));
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString(), cover: r.cover ? (covers[r.cover] ?? null) : null }));
}

/**
 * New deck. The treatment template lays out SPEC §5.5's sections; drafting from a board drops
 * the board's references into the media slots (motion first on the shot-approach slide).
 */
export async function createDeck(ctx: { workspaceId: string; userId: string }, input: { title: string; template: "treatment" | "blank"; boardId?: string | null }) {
  let pool: Reference[] = [];
  if (input.boardId) {
    await getBoard(ctx.workspaceId, input.boardId);
    pool = (await db()
      .select({ ref: references })
      .from(boardItems)
      .innerJoin(references, eq(references.id, boardItems.referenceId))
      .where(and(eq(boardItems.boardId, input.boardId), eq(references.status, "ready")))
      .orderBy(asc(boardItems.createdAt))).map((r) => r.ref).filter((r) => r.type !== "link" && r.type !== "note");
  }
  const motion = pool.filter((r) => r.type === "gif" || r.type === "clip");
  const take = (n: number, prefer: Reference[] = []) => {
    const out: string[] = [];
    for (const r of [...prefer, ...pool]) {
      if (out.length >= n) break;
      if (!out.includes(r.id)) out.push(r.id);
    }
    // Rotate so each slide shows something different while the board has enough.
    pool = [...pool.filter((r) => !out.includes(r.id)), ...pool.filter((r) => out.includes(r.id))];
    return out;
  };
  const template =
    input.template === "treatment"
      ? TREATMENT_TEMPLATE.map((t) => ({
          ...t,
          heading: t.section === "title" ? input.title : t.heading,
          mediaIds: t.layout === "grid" ? take(4) : t.layout === "media-text" ? take(1, t.section === "shots" ? motion : []) : [],
        }))
      : [{ section: "", layout: "title" as const, heading: input.title, body: "", mediaIds: [] as string[] }];
  return db().transaction(async (tx) => {
    const [deck] = await tx.insert(decks).values({ workspaceId: ctx.workspaceId, title: input.title, boardId: input.boardId ?? null, createdBy: ctx.userId }).returning();
    await tx.insert(slides).values(template.map((t, i) => ({ workspaceId: ctx.workspaceId, deckId: deck!.id, position: (i + 1) * 1024, layout: t.layout, section: t.section, heading: t.heading, body: t.body, mediaIds: t.mediaIds })));
    return deck!;
  });
}

export async function saveDeck(workspaceId: string, id: string, input: SaveDeck) {
  await getDeck(workspaceId, id);
  await assertRefs(workspaceId, input.slides.flatMap((s) => s.mediaIds));
  const ids = input.slides.map((s) => s.id);
  await db().transaction(async (tx) => {
    // Slide ids are client-made UUIDs; one that belongs to another deck can't be hijacked.
    if (ids.length) {
      const foreign = await tx.select({ id: slides.id }).from(slides).where(and(inArray(slides.id, ids), sql`${slides.deckId} <> ${id}`));
      if (foreign.length) throw new HttpError(409, "Those slides belong to another deck.");
    }
    await tx.delete(slides).where(ids.length ? and(eq(slides.deckId, id), notInArray(slides.id, ids)) : eq(slides.deckId, id));
    for (const [i, s] of input.slides.entries()) {
      const values = { layout: s.layout, section: s.section, heading: s.heading, body: s.body, mediaIds: s.mediaIds, notes: s.notes, position: (i + 1) * 1024 };
      await tx
        .insert(slides)
        .values({ id: s.id, workspaceId, deckId: id, ...values })
        .onConflictDoUpdate({ target: slides.id, set: { ...values, updatedAt: new Date() } });
    }
    await tx.update(decks).set({ title: input.title, theme: input.theme, updatedAt: new Date() }).where(eq(decks.id, id));
  });
}

/* ---------- reels ---------- */

export async function getReel(workspaceId: string, id: string) {
  const [reel] = await db().select().from(reels).where(and(eq(reels.id, id), eq(reels.workspaceId, workspaceId)));
  if (!reel) throw notFound("That reel doesn't exist in this workspace.");
  return reel;
}

export async function loadReel(workspaceId: string, id: string) {
  const reel = await getReel(workspaceId, id);
  const rows = await db().select().from(reelItems).where(eq(reelItems.reelId, id)).orderBy(asc(reelItems.position));
  return {
    reel: {
      id: reel.id,
      title: reel.title,
      titleCard: reel.titleCard,
      titleCardSub: reel.titleCardSub,
      endCard: reel.endCard,
      endCardSub: reel.endCardSub,
      renderUrl: reel.renderKey ? await storage().signedGetUrl(reel.renderKey, { expiresIn: 6 * 3600 }) : null,
      renderHash: reel.renderHash,
      updatedAt: reel.updatedAt.toISOString(),
    },
    items: rows.map((r) => ({ id: r.id, referenceId: r.referenceId, inSec: r.inSec, outSec: r.outSec })),
    media: await playables(workspaceId, rows.map((r) => r.referenceId)),
  };
}
export type ReelData = Awaited<ReturnType<typeof loadReel>>;

export async function listReels(workspaceId: string) {
  const rows = await db()
    .select({
      id: reels.id,
      title: reels.title,
      updatedAt: reels.updatedAt,
      count: sql<number>`(select count(*)::int from reel_items i where i.reel_id = ${reels.id})`,
      cover: sql<string | null>`(select i.reference_id::text from reel_items i where i.reel_id = ${reels.id} order by i.position limit 1)`,
    })
    .from(reels)
    .where(eq(reels.workspaceId, workspaceId))
    .orderBy(desc(reels.updatedAt));
  const covers = await playables(workspaceId, rows.map((r) => r.cover).filter((x): x is string => Boolean(x)));
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString(), cover: r.cover ? (covers[r.cover] ?? null) : null }));
}

export async function createReel(ctx: { workspaceId: string; userId: string }, input: { title: string }) {
  const [reel] = await db().insert(reels).values({ workspaceId: ctx.workspaceId, title: input.title, titleCard: input.title, createdBy: ctx.userId }).returning();
  return reel!;
}

export async function saveReel(workspaceId: string, id: string, input: SaveReel) {
  await getReel(workspaceId, id);
  const refIds = input.items.map((i) => i.referenceId);
  await assertRefs(workspaceId, refIds);
  if (refIds.length) {
    const kinds = await db().select({ type: references.type }).from(references).where(inArray(references.id, refIds));
    if (kinds.some((k) => k.type !== "video" && k.type !== "clip")) throw new HttpError(400, "Reels take videos and clips only.");
  }
  const ids = input.items.map((i) => i.id);
  await db().transaction(async (tx) => {
    if (ids.length) {
      const foreign = await tx.select({ id: reelItems.id }).from(reelItems).where(and(inArray(reelItems.id, ids), sql`${reelItems.reelId} <> ${id}`));
      if (foreign.length) throw new HttpError(409, "Those items belong to another reel.");
    }
    await tx.delete(reelItems).where(ids.length ? and(eq(reelItems.reelId, id), notInArray(reelItems.id, ids)) : eq(reelItems.reelId, id));
    for (const [i, item] of input.items.entries()) {
      const values = { referenceId: item.referenceId, inSec: item.inSec, outSec: item.outSec, position: (i + 1) * 1024 };
      await tx
        .insert(reelItems)
        .values({ id: item.id, workspaceId, reelId: id, ...values })
        .onConflictDoUpdate({ target: reelItems.id, set: { ...values, updatedAt: new Date() } });
    }
    await tx
      .update(reels)
      .set({ title: input.title, titleCard: input.titleCard, titleCardSub: input.titleCardSub, endCard: input.endCard, endCardSub: input.endCardSub, updatedAt: new Date() })
      .where(eq(reels.id, id));
  });
}

/* ---------- portfolio ---------- */

export async function loadPortfolio(where: { workspaceId: string } | { slug: string }) {
  const [p] = await db()
    .select()
    .from(portfolios)
    .where("slug" in where ? eq(portfolios.slug, where.slug) : eq(portfolios.workspaceId, where.workspaceId));
  if (!p) return null;
  const items = await db().select().from(portfolioItems).where(eq(portfolioItems.portfolioId, p.id)).orderBy(asc(portfolioItems.position));
  const reelIds = items.map((i) => i.reelId).filter((x): x is string => Boolean(x));
  const reelData = Object.fromEntries(await Promise.all(reelIds.map(async (r) => [r, await loadReel(p.workspaceId, r).catch(() => null)] as const)));
  return {
    portfolio: { id: p.id, slug: p.slug, title: p.title, bio: p.bio, contactEmail: p.contactEmail, website: p.website, template: p.template, published: p.published },
    items: items.map((i) => ({ id: i.id, referenceId: i.referenceId, reelId: i.reelId, caption: i.caption })),
    media: await playables(p.workspaceId, items.map((i) => i.referenceId).filter((x): x is string => Boolean(x))),
    reels: reelData,
  };
}
export type PortfolioData = NonNullable<Awaited<ReturnType<typeof loadPortfolio>>>;

export async function savePortfolio(workspaceId: string, input: SavePortfolio) {
  await assertRefs(workspaceId, input.items.map((i) => i.referenceId).filter((x): x is string => Boolean(x)));
  const reelIds = input.items.map((i) => i.reelId).filter((x): x is string => Boolean(x));
  if (reelIds.length) {
    const own = await db().select({ id: reels.id }).from(reels).where(and(eq(reels.workspaceId, workspaceId), inArray(reels.id, reelIds)));
    if (own.length !== new Set(reelIds).size) throw new HttpError(400, "Some of those reels aren't in this workspace.");
  }
  const [taken] = await db().select({ ws: portfolios.workspaceId }).from(portfolios).where(eq(portfolios.slug, input.slug));
  if (taken && taken.ws !== workspaceId) throw new HttpError(409, `“${input.slug}” is taken. Try another address.`);
  await db().transaction(async (tx) => {
    const values = { slug: input.slug, title: input.title, bio: input.bio, contactEmail: input.contactEmail, website: input.website, template: input.template, published: input.published };
    const [p] = await tx
      .insert(portfolios)
      .values({ workspaceId, ...values })
      .onConflictDoUpdate({ target: portfolios.workspaceId, set: { ...values, updatedAt: new Date() } })
      .returning();
    await tx.delete(portfolioItems).where(eq(portfolioItems.portfolioId, p!.id));
    if (input.items.length)
      await tx.insert(portfolioItems).values(input.items.map((i, n) => ({ workspaceId, portfolioId: p!.id, referenceId: i.referenceId, reelId: i.reelId, caption: i.caption, position: (n + 1) * 1024 })));
  });
}

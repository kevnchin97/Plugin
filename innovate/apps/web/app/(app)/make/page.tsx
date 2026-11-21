import { z } from "zod";
import { Intake } from "@/components/make/Intake";

export const metadata = { title: "GIF Maker" };

/** GIF Maker intake. Opened from a board (?board=), exports save back onto that board. */
export default async function MakePage({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const board = z.uuid().safeParse((await searchParams).board);
  return <Intake boardId={board.success ? board.data : null} />;
}

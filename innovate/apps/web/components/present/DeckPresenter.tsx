"use client";
import { useRouter } from "next/navigation";
import type { DeckData } from "@/lib/present";
import { Presenter } from "./Presenter";

export function DeckPresenter({ data, exitHref }: { data: DeckData; exitHref?: string }) {
  const router = useRouter();
  return (
    <div className="fixed inset-0">
      <Presenter title={data.deck.title} theme={data.deck.theme} slides={data.slides} media={data.media} onExit={exitHref ? () => router.push(exitHref) : undefined} />
    </div>
  );
}

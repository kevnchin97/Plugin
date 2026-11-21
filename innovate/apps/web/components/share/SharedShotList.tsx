"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FRAMING_LABEL, formatShotDuration } from "@innovate/shared";
import { aspectOf } from "@/components/board/cards";
import { MotionMedia } from "@/components/media/MotionMedia";
import { Logo } from "@/components/ui/Logo";
import type { RefLite } from "@/lib/boards";
import type { ShotListData } from "@/lib/shotlists";
import { useRealtime } from "@/lib/useRealtime";

function Motion({ r }: { r: RefLite }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={box}>
      <div className="overflow-hidden rounded-sm bg-player" style={{ aspectRatio: aspectOf(r) }}>
        <MotionMedia item={r} active={visible} />
      </div>
      <div className="mt-0.5 truncate text-2xs text-text-faint">{r.title}</div>
    </div>
  );
}

/** A shot list shared as a live link: read-only, updates as the team edits. */
export function SharedShotList({ token, data }: { token: string; data: ShotListData }) {
  const router = useRouter();
  const onEvent = useCallback((e: { type: string }) => e.type === "ops" && router.refresh(), [router]);
  useRealtime(`/api/s/${token}/ticket`, onEvent);
  const [hash, setHash] = useState("");
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1));
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const total = data.shots.reduce((a, s) => a + (s.durationSec ?? 0), 0);
  return (
    <div className="h-full overflow-y-auto">
      <header className="flex h-11 items-center gap-3 border-b border-border px-4">
        <Logo />
        <h1 className="font-medium" data-testid="shared-title">
          {data.list.title}
        </h1>
        <span className="text-xs text-text-faint tabular">
          {data.shots.length} shots · {formatShotDuration(total) || "0s"} · live
        </span>
      </header>
      <table className="w-full min-w-[1000px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border-strong text-left text-2xs tracking-[0.1em] text-text-faint uppercase">
            {["#", "Scene", "Setting", "Description", "Framing", "Camera", "Duration", "Status", "Motion reference"].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.shots.map((s) => {
            const r = s.motionReferenceId ? data.references[s.motionReferenceId] : undefined;
            return (
              <tr key={s.id} id={`shot-${s.id}`} className={`border-b border-border align-top ${hash === `shot-${s.id}` ? "bg-accent-soft" : "bg-surface"}`} data-testid="shared-shot">
                <td className="px-3 py-2 font-mono font-medium">{s.number}</td>
                <td className="px-3 py-2">{s.scene}</td>
                <td className="px-3 py-2">{s.setting}</td>
                <td className="max-w-[360px] px-3 py-2 whitespace-pre-wrap" data-testid="shared-description">
                  {s.description}
                </td>
                <td className="px-3 py-2" title={s.framing ? FRAMING_LABEL[s.framing] : undefined}>
                  {s.framing}
                </td>
                <td className="px-3 py-2 text-text-muted">{[s.movement, s.lens, s.rig].filter(Boolean).join(" · ")}</td>
                <td className="px-3 py-2 font-mono">{formatShotDuration(s.durationSec)}</td>
                <td className="px-3 py-2 capitalize">{s.status}</td>
                <td className="w-[220px] px-3 py-2">{r && <Motion r={r} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isTypingTarget } from "@/lib/shortcuts";

/** Header search box: Enter opens /search; "/" focuses it from anywhere. */
export function HeaderSearch() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const onSearch = path === "/search";
  const [q, setQ] = useState(onSearch ? (params.get("q") ?? "") : "");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      role="search"
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        const text = q.trim();
        if (!text) return;
        const next = new URLSearchParams(onSearch ? params : undefined);
        next.set("q", text);
        router.push(`/search?${next}`);
        input.current?.blur();
      }}
    >
      <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        ref={input}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && input.current?.blur()}
        placeholder="Search by look…"
        aria-label="Search the library"
        className="h-7 w-[220px] rounded-md border border-transparent bg-surface-3 pr-8 pl-7 text-sm placeholder:text-text-faint focus:border-accent focus:outline-none"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-sm border border-border px-1 text-2xs text-text-faint">/</kbd>
    </form>
  );
}

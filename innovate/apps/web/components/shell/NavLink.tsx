"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-md px-2.5 py-1 text-sm transition-colors ${active ? "bg-surface-3 text-text" : "text-text-muted hover:text-text"}`}
    >
      {children}
    </Link>
  );
}

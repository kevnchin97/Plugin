"use client";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { CommandBar } from "@/components/agents/CommandBar";
import { Logo } from "@/components/ui/Logo";
import { HeaderSearch } from "./HeaderSearch";
import { ShortcutsButton } from "./ShortcutsOverlay";
import { ThemeToggle } from "./ThemeToggle";

interface Section {
  href: string;
  label: string;
  icon: string;
  /** One line on what it's for, shown under the label in the menu. */
  hint: string;
  group: "home" | "present" | "more";
}

const SECTIONS: Section[] = [
  { href: "/", label: "Home", hint: "Your boards: collect and arrange references", group: "home", icon: "M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" },
  { href: "/library", label: "Library", hint: "Everything you've saved, in one place", group: "home", icon: "M5 4h4v16H5zM10.5 4h4v16h-4zM16 5l3.5.9-3.6 14-3.4-.9z" },
  { href: "/shotlists", label: "Shot lists", hint: "Plan a shoot, shot by shot", group: "present", icon: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" },
  { href: "/decks", label: "Decks", hint: "Treatments and pitch decks to present", group: "present", icon: "M4 5h16v11H4zM12 16v4M8 20h8" },
  { href: "/agents", label: "Agents", hint: "AI helpers (⌘K)", group: "more", icon: "M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" },
  { href: "/settings", label: "Settings", hint: "", group: "more", icon: "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 3l1.8 2.6 3.1-.6.6 3.1L20 10l-1.5 2 1.5 2-2.5 1.9-.6 3.1-3.1-.6L12 21l-1.8-2.6-3.1.6-.6-3.1L4 14l1.5-2L4 10l2.5-1.9.6-3.1 3.1.6z" },
];
const GROUPS: { key: Section["group"]; title: string | null }[] = [
  { key: "home", title: null },
  { key: "present", title: "Plan and present" },
];
/**
 * Pages reached from elsewhere still get a breadcrumb: search, and the GIF Maker (opened from a
 * board), reels and the portfolio (kept, but not part of the board-first app).
 */
const CRUMB_ONLY = [
  { href: "/search", label: "Search" },
  { href: "/make", label: "GIF Maker" },
  { href: "/reels", label: "Reels" },
  { href: "/portfolio", label: "Portfolio" },
];

const Icon = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

function NavItem({ s, path, onNavigate }: { s: Section; path: string; onNavigate(): void }) {
  const active = s.href === "/" ? path === "/" || path.startsWith("/boards") : path === s.href || path.startsWith(`${s.href}/`);
  return (
    <Link
      href={s.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-start gap-3 rounded-md px-3 py-2 ${active ? "bg-accent-soft" : "hover:bg-surface-3"}`}
    >
      <span className={`mt-0.5 ${active ? "text-accent" : "text-text-faint"}`}>
        <Icon d={s.icon} />
      </span>
      <span className="min-w-0">
        <span className={`block text-md leading-5 ${active ? "font-medium text-accent" : "text-text"}`}>{s.label}</span>
        <span className="block text-xs leading-4 text-text-faint">{s.hint}</span>
      </span>
    </Link>
  );
}

function sectionFor(path: string) {
  if (path === "/" || path.startsWith("/boards")) return null; // boards render their own breadcrumbs
  return [...SECTIONS, ...CRUMB_ONLY].filter((s) => s.href !== "/").find((s) => path === s.href || path.startsWith(`${s.href}/`)) ?? null;
}

/**
 * The app frame (Milanote-style): one slim top bar (menu, breadcrumbs, the page's own actions,
 * search, Ask, help, account) and a navigation drawer. Boards fill the rest edge to edge.
 */
export function AppShell({
  children,
  user,
  theme,
  agentsEnabled,
  signOut,
}: {
  children: React.ReactNode;
  user: { initial: string; email: string };
  theme: "light" | "dark";
  agentsEnabled: boolean;
  signOut: () => Promise<void>;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const section = sectionFor(path);
  return (
    <div className="flex h-full flex-col">
      <header className="relative z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <button type="button" aria-label="Menu" className="relative z-10 grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text">
              <Icon d="M4 7h16M4 12h16M4 17h16" />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
            <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 flex w-[300px] flex-col bg-surface shadow-xl focus:outline-none" data-testid="nav-drawer">
              <div className="flex h-12 items-center justify-between border-b border-border px-4">
                <Dialog.Title className="text-text">
                  <Logo />
                </Dialog.Title>
                <Dialog.Close aria-label="Close menu" className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-surface-3">
                  <Icon d="M6 6l12 12M18 6 6 18" size={16} />
                </Dialog.Close>
              </div>
              <nav aria-label="Main" className="flex-1 overflow-y-auto p-2">
                {GROUPS.map((g) => (
                  <div key={g.key} className={g.title ? "mt-4" : ""}>
                    {g.title && <div className="px-3 pb-1 text-2xs font-medium tracking-[0.1em] text-text-faint uppercase">{g.title}</div>}
                    {SECTIONS.filter((s) => s.group === g.key).map((s) => (
                      <NavItem key={s.href} s={s} path={path} onNavigate={() => setOpen(false)} />
                    ))}
                  </div>
                ))}
                <div className="mt-4 flex gap-1 border-t border-border pt-2">
                  {SECTIONS.filter((s) => s.group === "more").map((s) => {
                    const active = path === s.href || path.startsWith(`${s.href}/`);
                    return (
                      <Link
                        key={s.href}
                        href={s.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        title={s.hint || undefined}
                        className={`flex flex-1 items-center justify-center gap-2 rounded-md px-2 py-2 text-sm ${active ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-3 hover:text-text"}`}
                      >
                        <Icon d={s.icon} size={16} />
                        {s.label}
                      </Link>
                    );
                  })}
                </div>
              </nav>
              <div className="flex items-center justify-between gap-2 border-t border-border p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm">{user.email}</div>
                  <form action={signOut}>
                    <button type="submit" className="text-xs text-text-muted hover:text-text">
                      Sign out
                    </button>
                  </form>
                </div>
                <ThemeToggle initial={theme} />
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <nav aria-label="Breadcrumbs" className="relative z-10 flex min-w-0 flex-1 items-center gap-1 text-sm" id="shell-crumbs">
          {section && (
            <>
              <Link href="/" className="rounded-sm px-1 text-text-muted hover:text-text">
                Home
              </Link>
              <span className="text-text-faint">/</span>
              <Link href={section.href} className="truncate rounded-sm px-1 font-medium text-text">
                {section.label}
              </Link>
            </>
          )}
        </nav>
        {/* Centred page title (boards put theirs here, Milanote-style). */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex h-12 items-center justify-center">
          <div id="shell-title" className="pointer-events-auto max-w-[36vw] truncate" />
        </div>
        <div id="shell-actions" className="relative flex shrink-0 items-center gap-1.5" />
        <div className="relative ml-1 flex shrink-0 items-center gap-1.5">
          <Suspense>
            <HeaderSearch />
          </Suspense>
          <CommandBar enabled={agentsEnabled} />
          <ShortcutsButton />
          <button
            type="button"
            onClick={() => setOpen(true)}
            title={`Signed in as ${user.email}`}
            aria-label="Account"
            className="grid h-7 w-7 place-items-center rounded-full bg-accent text-xs font-medium text-accent-fg"
          >
            {user.initial}
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

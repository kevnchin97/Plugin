import { cookies } from "next/headers";
import Link from "next/link";
import { signOut } from "@/auth";
import { NavLink } from "@/components/shell/NavLink";
import { ShortcutsButton, ShortcutsProvider } from "@/components/shell/ShortcutsOverlay";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { Logo } from "@/components/ui/Logo";
import { ToastProvider } from "@/components/ui/Toasts";
import { requirePageSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageSession();
  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }
  const theme = (await cookies()).get("innovate-theme")?.value === "light" ? "light" : "dark";
  const initial = (ctx.user.name || ctx.user.email || "?").slice(0, 1).toUpperCase();
  return (
    <ToastProvider>
      <ShortcutsProvider>
        <div className="flex h-full flex-col">
          <header className="flex h-11 shrink-0 items-center gap-4 border-b border-border px-4">
            <Link href="/" className="text-text" aria-label="Innovate home">
              <Logo />
            </Link>
            <nav className="flex items-center gap-1" aria-label="Main">
              <NavLink href="/">Library</NavLink>
              <NavLink href="/make">GIF Maker</NavLink>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <ShortcutsButton />
              <ThemeToggle initial={theme} />
              <form action={doSignOut}>
                <button
                  type="submit"
                  title={`Signed in as ${ctx.user.email ?? ""}. Sign out`}
                  aria-label="Sign out"
                  className="grid h-7 w-7 place-items-center rounded-full bg-surface-4 text-xs font-medium text-text-muted hover:text-text"
                >
                  {initial}
                </button>
              </form>
            </div>
          </header>
          <div className="min-h-0 flex-1">{children}</div>
        </div>
      </ShortcutsProvider>
    </ToastProvider>
  );
}

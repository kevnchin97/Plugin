import { cookies } from "next/headers";
import { signOut } from "@/auth";
import { AppShell } from "@/components/shell/AppShell";
import { ShortcutsProvider } from "@/components/shell/ShortcutsOverlay";
import { ToastProvider } from "@/components/ui/Toasts";
import { agentsEnabled } from "@/lib/agents";
import { requirePageSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageSession();
  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }
  const theme = (await cookies()).get("innovate-theme")?.value === "dark" ? "dark" : "light";
  return (
    <ToastProvider>
      <ShortcutsProvider>
        <AppShell
          user={{ initial: (ctx.user.name || ctx.user.email || "?").slice(0, 1).toUpperCase(), email: ctx.user.email ?? "" }}
          theme={theme}
          agentsEnabled={agentsEnabled()}
          signOut={doSignOut}
        >
          {children}
        </AppShell>
      </ShortcutsProvider>
    </ToastProvider>
  );
}

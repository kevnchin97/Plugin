"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { createContext, useContext, useEffect, useState } from "react";
import { Kbd } from "@/components/ui/Kbd";
import { BOARD_SHORTCUTS, isTypingTarget, SHORTCUTS } from "@/lib/shortcuts";

const Ctx = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({ open: false, setOpen: () => {} });
export const useShortcutsOverlay = () => useContext(Ctx);

const GROUPS = ["Playback", "Navigate", "Marks", "Export", "View"] as const;
const GROUP_LABEL: Record<(typeof GROUPS)[number], string> = {
  Playback: "GIF Maker · Playback",
  Navigate: "GIF Maker · Navigate",
  Marks: "GIF Maker · Marks",
  Export: "GIF Maker · Export",
  View: "GIF Maker · View",
};

export function ShortcutsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Ctx.Provider value={{ open, setOpen }}>
      {children}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 max-h-[85vh] focus:outline-none w-[min(760px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-border-strong bg-surface-2 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
          >
            <div className="mb-5 flex items-baseline justify-between">
              <Dialog.Title className="text-lg font-semibold">Keyboard shortcuts</Dialog.Title>
              <span className="text-sm text-text-faint">
                Press <Kbd>?</Kbd> or <Kbd>Esc</Kbd> to close
              </span>
            </div>
            <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
              {GROUPS.map((group) => (
                <section key={group}>
                  <h3 className="mb-2 text-2xs font-medium tracking-[0.12em] text-text-faint uppercase">{GROUP_LABEL[group]}</h3>
                  <ul className="space-y-1.5">
                    {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                      <li key={s.action} className="flex items-center justify-between gap-4 text-sm" data-shortcut={s.action}>
                        <span className="text-text-muted">{s.label}</span>
                        <span className="flex shrink-0 gap-1">
                          {s.keys.map((k) => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <section>
                <h3 className="mb-2 text-2xs font-medium tracking-[0.12em] text-text-faint uppercase">Boards</h3>
                <ul className="space-y-1.5">
                  {BOARD_SHORTCUTS.map((s) => (
                    <li key={s.label} className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-text-muted">{s.label}</span>
                      <span className="flex shrink-0 gap-1">
                        {s.keys.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Ctx.Provider>
  );
}

export function ShortcutsButton() {
  const { setOpen } = useShortcutsOverlay();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Keyboard shortcuts"
      title="Keyboard shortcuts (?)"
      className="grid h-7 w-7 place-items-center rounded-md border border-border text-sm text-text-muted hover:border-border-strong hover:text-text"
    >
      ?
    </button>
  );
}

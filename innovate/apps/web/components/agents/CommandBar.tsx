"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toasts";

const EXAMPLES = [
  "Research references for a rainy neon chase",
  "Pull GIFs of every whip pan in this link: ",
  "Build a moodboard from my last three uploads",
  "Draft a treatment deck from Winter Ad",
  "Assemble a 60-second reel of my car work",
];

/**
 * Cmd+K (Ctrl+K) command bar for agents (SPEC §5.8, limited beta). A request starts an agent run
 * and opens its panel; the agent only proposes changes for you to approve.
 */
export function CommandBar({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    // The board's Ask bar (and anything else) can open the command bar with this event.
    const onAsk = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("innovate:ask", onAsk);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("innovate:ask", onAsk);
    };
  }, []);

  const submit = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't start the agent.");
      setOpen(false);
      setPrompt("");
      router.push(`/agents/${body.task.id}`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-sm text-text-muted hover:text-text" aria-label="Ask an agent (Command K)">
          Ask
          <kbd className="rounded-sm border border-border px-1 text-2xs text-text-faint">⌘K</kbd>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            input.current?.focus();
          }}
          className="fixed top-[18%] left-1/2 z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-lg border border-border-strong bg-surface shadow-xl"
          data-testid="command-bar"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <Dialog.Title className="text-sm font-medium">Ask an agent</Dialog.Title>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent">Limited beta</span>
          </div>
          {enabled ? (
            <>
              <textarea
                ref={input}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                rows={3}
                placeholder="What should the agent do? It proposes; you approve."
                aria-label="Agent request"
                className="block w-full resize-none bg-transparent px-4 py-3 text-md outline-none placeholder:text-text-faint"
              />
              <div className="border-t border-border px-2 py-2">
                <div className="px-2 pb-1 text-2xs font-medium tracking-[0.08em] text-text-faint uppercase">Try</div>
                <ul>
                  {EXAMPLES.map((ex) => (
                    <li key={ex}>
                      <button
                        type="button"
                        onClick={() => {
                          setPrompt(ex);
                          input.current?.focus();
                        }}
                        className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-text-muted hover:bg-surface-2 hover:text-text"
                      >
                        {ex.trim()}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-text-faint">
                <span>Enter to start · Shift+Enter for a new line</span>
                <button type="button" onClick={() => void submit()} disabled={!prompt.trim() || busy} className="h-7 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-50">
                  {busy ? "Starting…" : "Start"}
                </button>
              </div>
            </>
          ) : (
            <p className="px-4 py-6 text-sm text-text-muted">
              Agents run on Claude and need <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> on the server. Ask whoever runs Innovate to add it.
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

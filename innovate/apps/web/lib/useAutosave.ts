"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "saved" | "saving" | "dirty" | "error";

/**
 * Debounced whole-document autosave (PUT `url` with `value`). One save is in flight at a time;
 * edits made during a save are sent right after it. `value` must be memoised by the caller.
 */
export function useAutosave<T>(url: string, value: T, handlers: { onSaved(body: unknown): void; onError(message: string): void }, delay = 600) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const latest = useRef(value);
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const h = useRef(handlers);
  useEffect(() => {
    h.current = handlers;
  });

  const save = useCallback((): Promise<void> => {
    if (inFlight.current) {
      again.current = true;
      return inFlight.current;
    }
    const run = async () => {
      do {
        again.current = false;
        setStatus("saving");
        try {
          const res = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(latest.current) });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error((body as { error?: string }).error ?? "Couldn't save. Check your connection and try again.");
          h.current.onSaved(body);
          if (!again.current) setStatus("saved");
        } catch (err) {
          setStatus("error");
          h.current.onError((err as Error).message);
          break;
        }
      } while (again.current);
      inFlight.current = null;
    };
    inFlight.current = run();
    return inFlight.current;
  }, [url]);

  const first = useRef(true);
  useEffect(() => {
    latest.current = value;
    if (first.current) {
      first.current = false;
      return;
    }
    setStatus("dirty");
    const t = setTimeout(() => void save(), delay);
    return () => clearTimeout(t);
  }, [value, save, delay]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (status === "saved") return;
    const before = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [status]);

  return { status, save };
}

export const saveLabel = (s: SaveStatus) => (s === "saving" ? "Saving…" : s === "dirty" ? "Unsaved" : s === "error" ? "Not saved" : "Saved");

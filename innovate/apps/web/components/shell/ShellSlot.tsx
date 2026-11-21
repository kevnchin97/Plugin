"use client";
import { createPortal } from "react-dom";
import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * Render page-specific content into the app's single top bar (Milanote-style: one slim bar with
 * breadcrumbs on the left, the title centred, and the page's actions on the right). Slots: "crumbs", "title", "actions".
 */
export function ShellSlot({ slot, children }: { slot: "crumbs" | "title" | "actions"; children: React.ReactNode }) {
  const el = useSyncExternalStore(
    noop,
    () => document.getElementById(`shell-${slot}`),
    () => null,
  );
  return el ? createPortal(children, el) : null;
}

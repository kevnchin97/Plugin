"use client";
import { useEffect, useRef, useState } from "react";

export interface Member {
  id: string;
  name: string;
  kind: string;
}

/**
 * Join a realtime room. `ticketUrl` returns { url, ticket } (10-minute ticket); we reconnect with
 * backoff and fetch a fresh ticket each time. Events are delivered to `onEvent`.
 */
export function useRealtime(ticketUrl: string | null, onEvent: (e: { type: string; [k: string]: unknown }) => void) {
  const [members, setMembers] = useState<Member[]>([]);
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!ticketUrl) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    const connect = async () => {
      try {
        const res = await fetch(ticketUrl);
        if (!res.ok) throw new Error(String(res.status));
        const { url, ticket } = (await res.json()) as { url: string; ticket: string };
        if (stopped) return;
        ws = new WebSocket(`${url}?ticket=${encodeURIComponent(ticket)}`);
        ws.onopen = () => {
          attempt = 0;
          setConnected(true);
          ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
        };
        ws.onmessage = (m) => {
          try {
            const e = JSON.parse(String(m.data)) as { type: string; members?: Member[] };
            if (e.type === "presence") setMembers(e.members ?? []);
            else if (e.type !== "pong") handler.current(e);
          } catch {
            /* ignore malformed */
          }
        };
        ws.onclose = () => {
          setConnected(false);
          if (ping) clearInterval(ping);
          if (!stopped) timer = setTimeout(() => void connect(), Math.min(15_000, 500 * 2 ** attempt++));
        };
      } catch {
        if (!stopped) timer = setTimeout(() => void connect(), Math.min(15_000, 500 * 2 ** attempt++));
      }
    };
    void connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (ping) clearInterval(ping);
      ws?.close();
    };
  }, [ticketUrl]);

  return { members, connected };
}

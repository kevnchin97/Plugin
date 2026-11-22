/**
 * Realtime fan-out (SPEC §3: "a thin ws server"). Clients connect with a short-lived ticket
 * signed by the web app (room + identity); the server joins them to the room, tracks presence,
 * and relays every message published for `rt:<room>` (Redis on servers, an in-process bus in the
 * desktop app). It never touches the database.
 */
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { type RealtimeTicket, verify } from "@innovate/shared/signing";

type Rooms = Map<string, Set<Client>>;

interface Client {
  ws: WebSocket;
  ticket: RealtimeTicket;
  alive: boolean;
}

function members(rooms: Rooms, room: string) {
  const seen = new Map<string, { id: string; name: string; kind: string }>();
  for (const c of rooms.get(room) ?? []) seen.set(c.ticket.id, { id: c.ticket.id, name: c.ticket.name, kind: c.ticket.kind });
  return [...seen.values()];
}

function broadcast(rooms: Rooms, room: string, data: string) {
  for (const c of rooms.get(room) ?? []) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
}

/**
 * Start the server. `subscribe` connects the message source: it calls back with (channel, message)
 * for every `rt:*` channel and returns an unsubscribe function.
 */
export async function startRealtime(opts: { port: number; host?: string; subscribe(on: (channel: string, message: string) => void): Promise<() => void> }) {
  const rooms: Rooms = new Map();
  const unsubscribe = await opts.subscribe((channel, message) => broadcast(rooms, channel.slice(3), message));

  const http = createServer((req, res) => {
    res.writeHead(req.url === "/health" ? 200 : 404, { "content-type": "text/plain" }).end(req.url === "/health" ? "ok" : "not found");
  });
  const wss = new WebSocketServer({ server: http, maxPayload: 16 * 1024 });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://x");
    const ticket = verify<RealtimeTicket>(url.searchParams.get("ticket"), "realtime");
    if (!ticket) {
      ws.close(4401, "invalid ticket");
      return;
    }
    const client: Client = { ws, ticket, alive: true };
    const room = ticket.room;
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room)!.add(client);
    broadcast(rooms, room, JSON.stringify({ type: "presence", members: members(rooms, room) }));

    ws.on("pong", () => (client.alive = true));
    ws.on("message", (raw) => {
      // Clients only send pings; everything else goes through the web API (validated, persisted).
      if (raw.toString() === "ping") ws.send(JSON.stringify({ type: "pong" }));
    });
    ws.on("close", () => {
      rooms.get(room)?.delete(client);
      if (!rooms.get(room)?.size) rooms.delete(room);
      else broadcast(rooms, room, JSON.stringify({ type: "presence", members: members(rooms, room) }));
    });
  });

  setInterval(() => {
    for (const set of rooms.values())
      for (const c of set) {
        if (!c.alive) c.ws.terminate();
        else {
          c.alive = false;
          c.ws.ping();
        }
      }
  }, 20_000).unref();

  await new Promise<void>((done) => http.listen(opts.port, opts.host, done));
  console.log(`[realtime] listening on :${opts.port}`);
  return {
    async close() {
      unsubscribe();
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}

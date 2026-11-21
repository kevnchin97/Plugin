/**
 * Realtime fan-out (SPEC §3: "a thin ws server"). Clients connect with a short-lived ticket
 * signed by the web app (room + identity); the server joins them to the room, tracks presence,
 * and relays everything published on Redis channel `rt:<room>`. It never touches the database.
 */
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Redis } from "ioredis";
import { WebSocket, WebSocketServer } from "ws";
import { type RealtimeTicket, verify } from "@innovate/shared/signing";

config({ path: resolve(fileURLToPath(new URL("../../../", import.meta.url)), ".env"), quiet: true });

const PORT = Number(process.env.REALTIME_PORT || 3001);

interface Client {
  ws: WebSocket;
  ticket: RealtimeTicket;
  alive: boolean;
}

const rooms = new Map<string, Set<Client>>();

function members(room: string) {
  const seen = new Map<string, { id: string; name: string; kind: string }>();
  for (const c of rooms.get(room) ?? []) seen.set(c.ticket.id, { id: c.ticket.id, name: c.ticket.name, kind: c.ticket.kind });
  return [...seen.values()];
}

function broadcast(room: string, data: string) {
  for (const c of rooms.get(room) ?? []) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
}

const sub = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
await sub.psubscribe("rt:*");
sub.on("pmessage", (_pattern, channel, message) => broadcast(channel.slice(3), message));

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
  broadcast(room, JSON.stringify({ type: "presence", members: members(room) }));

  ws.on("pong", () => (client.alive = true));
  ws.on("message", (raw) => {
    // Clients only send pings; everything else goes through the web API (validated, persisted).
    if (raw.toString() === "ping") ws.send(JSON.stringify({ type: "pong" }));
  });
  ws.on("close", () => {
    rooms.get(room)?.delete(client);
    if (!rooms.get(room)?.size) rooms.delete(room);
    else broadcast(room, JSON.stringify({ type: "presence", members: members(room) }));
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

http.listen(PORT, () => console.log(`[realtime] listening on :${PORT}`));

const shutdown = () => {
  wss.close();
  sub.disconnect();
  http.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

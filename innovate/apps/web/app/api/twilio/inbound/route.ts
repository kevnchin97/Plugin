import { adapterFor } from "@innovate/shared/adapters";
import { rateLimit } from "@innovate/shared/realtime";
import { linksIn, parseSender, twiml, validTwilioSignature } from "@innovate/shared/twilio";
import { INBOX_BOARD, inboxBoard, ownerOf } from "@/lib/phones";
import { saveFromWeb } from "@/lib/save";

const IMAGE = /\.(jpe?g|png|webp|gif|avif)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i;
const xml = (message: string, status = 200) => new Response(twiml(message), { status, headers: { "content-type": "text/xml; charset=utf-8" } });

/**
 * Twilio webhook for text-to-save (SPEC §5.3), for SMS and WhatsApp. Configure the number's
 * "A message comes in" webhook (HTTP POST) to TWILIO_WEBHOOK_URL. Requests must carry a valid
 * X-Twilio-Signature. Links texted from a verified number are saved to the owner's
 * "Inbox from text" board; the reply confirms what was saved.
 */
export async function POST(req: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return new Response("Text-to-save isn't configured (TWILIO_AUTH_TOKEN).", { status: 503 });
  const form = await req.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const url = process.env.TWILIO_WEBHOOK_URL || req.url;
  if (!validTwilioSignature(token, url, params, req.headers.get("x-twilio-signature"))) return new Response("Invalid signature", { status: 403 });

  const sender = parseSender(params.From ?? "");
  if (!sender) return xml("Innovate couldn't read your number.");
  if (!(await rateLimit(`text-to-save:${sender.phone}`, 30, 3600))) return xml("That's a lot of links in an hour. Try again later.");
  const owner = await ownerOf(sender.phone);
  if (!owner) return xml("This number isn't connected to Innovate yet. Add it in Settings → Text to save, then text your link again.");

  const links = linksIn(params.Body ?? "");
  if (!links.length) return xml(`Text a link (a video, image or page) and Innovate saves it to “${INBOX_BOARD}”.`);

  const ctx = { userId: owner.userId, workspaceId: owner.workspaceId };
  const boardId = await inboxBoard(owner.workspaceId, owner.userId);
  let saved = 0;
  const failed: string[] = [];
  for (const link of links) {
    const u = new URL(link);
    const kind = IMAGE.test(u.pathname) ? "image" : VIDEO.test(u.pathname) || adapterFor(u) ? "video" : "page";
    try {
      await saveFromWeb(ctx, { kind, url: link, boardId, note: `Texted from ${sender.channel === "whatsapp" ? "WhatsApp" : "SMS"}` });
      saved++;
    } catch {
      // A video we can't import (e.g. a platform without an adapter) is still worth keeping as a link.
      try {
        await saveFromWeb(ctx, { kind: "page", url: link, boardId, note: `Texted from ${sender.channel === "whatsapp" ? "WhatsApp" : "SMS"}` });
        saved++;
      } catch {
        failed.push(u.hostname);
      }
    }
  }
  const msg = saved ? `Saved ${saved} ${saved === 1 ? "link" : "links"} to “${INBOX_BOARD}” in Innovate.` : "Innovate couldn't save that.";
  return xml(failed.length ? `${msg} Couldn't save: ${failed.join(", ")}.` : msg);
}

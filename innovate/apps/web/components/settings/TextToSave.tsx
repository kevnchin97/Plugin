"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toasts";

interface Phone {
  id: string;
  phone: string;
  verified: boolean;
}

/** Text-to-save (SPEC §5.3): verify a phone number, then text links to the Innovate number. */
export function TextToSave({ initial, textTo, whatsappTo }: { initial: Phone[]; textTo: string | null; whatsappTo: string | null }) {
  const toast = useToast();
  const [phones, setPhones] = useState(initial);
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  const call = async (method: string, body: unknown) => {
    const res = await fetch("/api/settings/phones", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "That didn't work.");
    return json.phone as Phone;
  };
  const send = async () => {
    try {
      const p = await call("POST", { phone, channel });
      setSentTo(p.phone);
      setPhones((cur) => [...cur.filter((x) => x.id !== p.id), p]);
      toast(`Code sent to ${p.phone}`, "success");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };
  const verify = async () => {
    try {
      const p = await call("PUT", { phone: sentTo, code });
      setPhones((cur) => cur.map((x) => (x.id === p.id ? p : x)));
      setSentTo(null);
      setCode("");
      setPhone("");
      toast("Number verified", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };
  const remove = async (id: string) => {
    const res = await fetch(`/api/settings/phones/${id}`, { method: "DELETE" });
    if (res.ok) setPhones((cur) => cur.filter((x) => x.id !== id));
  };

  return (
    <div className="space-y-3">
      {phones.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border" data-testid="phones">
          {phones.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="font-mono">{p.phone}</span>
              <span className="flex items-center gap-3">
                <span className={p.verified ? "text-success" : "text-text-faint"}>{p.verified ? "Verified" : "Not verified"}</span>
                <button type="button" onClick={() => void remove(p.id)} className="text-danger hover:underline">
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {sentTo ? (
        <div className="flex items-end gap-2">
          <label className="text-xs text-text-muted">
            Code sent to {sentTo}
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} aria-label="Verification code" className="mt-1 h-8 w-32 rounded-md border border-border-strong bg-surface px-2 font-mono text-sm tracking-[0.2em] text-text" />
          </label>
          <Button variant="primary" onClick={() => void verify()}>
            Verify
          </Button>
          <button type="button" onClick={() => setSentTo(null)} className="h-8 px-2 text-sm text-text-muted hover:text-text">
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <label className="text-xs text-text-muted">
            Your number
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 7700 900123" aria-label="Phone number" className="mt-1 h-8 w-56 rounded-md border border-border-strong bg-surface px-2 text-sm text-text" />
          </label>
          <select value={channel} onChange={(e) => setChannel(e.target.value as "sms" | "whatsapp")} aria-label="Send the code by" className="h-8 rounded-md border border-border-strong bg-surface px-2 text-sm">
            <option value="sms">by SMS</option>
            <option value="whatsapp">by WhatsApp</option>
          </select>
          <Button onClick={() => void send()} disabled={!phone.trim()}>
            Send code
          </Button>
        </div>
      )}
      <p className="text-sm text-text-muted">
        {textTo || whatsappTo ? (
          <>
            Then text links to <span className="font-mono text-text">{textTo ?? whatsappTo}</span>
            {textTo && whatsappTo && (
              <>
                {" "}
                (or WhatsApp <span className="font-mono text-text">{whatsappTo}</span>)
              </>
            )}
            . They land on your “Inbox from text” board.
          </>
        ) : (
          "Texting links needs a Twilio number on the server (TWILIO_PHONE_NUMBER and the webhook). You can verify your number now."
        )}
      </p>
    </div>
  );
}

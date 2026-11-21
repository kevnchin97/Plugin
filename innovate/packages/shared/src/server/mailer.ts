/**
 * Outgoing email. With EMAIL_SERVER set it sends over SMTP (nodemailer); otherwise it prints the
 * message (development) and appends it to MAIL_LOG_FILE if set (the e2e tests read that file).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export async function sendMail(mail: Mail): Promise<void> {
  const server = process.env.EMAIL_SERVER;
  const from = process.env.EMAIL_FROM || "Innovate <login@localhost>";
  if (server) {
    const nodemailer = await import("nodemailer");
    await nodemailer.createTransport(server).sendMail({ from, ...mail });
    return;
  }
  console.log(`\n[mail] to ${mail.to}: ${mail.subject}\n${mail.text}\n`);
  const log = process.env.MAIL_LOG_FILE;
  if (log) {
    const file = isAbsolute(log) ? log : resolve(process.env.INNOVATE_ROOT ?? process.cwd(), log);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ ...mail, at: new Date().toISOString() }) + "\n");
  }
}

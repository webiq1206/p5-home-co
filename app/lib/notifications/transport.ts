/**
 * How a message actually leaves the building.
 *
 * The interface exists so the dispatcher does not care: swapping SMTP for a
 * transactional API, or adding SMS for Critical only, should not touch the
 * routing rules that decide who hears what.
 */

import type { Message } from "./render.ts";
import { getSmtpConfig, assertSmtpAccepted } from "./smtp-config.ts";

export type SendResult = { ok: true } | { ok: false; error: string };

/** One retry, and only for a dropped connection or a 4xx mailbox reply. Auth and 5xx stop. */
export function isTransientSmtpError(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = `${error instanceof Error ? error.message : String(error)} ${code}`;
  if (/EAUTH|535|534|invalid login|authentication/i.test(message)) return false;
  if (/\b5\d\d\b/.test(message) && !/\b4\d\d\b/.test(message)) return false;
  return /ETIMEDOUT|ECONNRESET|ESOCKET|ECONNECTION|timed out|\b4\d\d\b|try again/i.test(message);
}

export async function sendWithRetry(
  send: () => Promise<void>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<SendResult> {
  try {
    await send();
    return { ok: true };
  } catch (error) {
    if (!isTransientSmtpError(error)) return { ok: false, error: error instanceof Error ? error.message : String(error) };
    try {
      await sleep(2_000);
      await send();
      return { ok: true };
    } catch (again) {
      return { ok: false, error: again instanceof Error ? again.message : String(again) };
    }
  }
}

export type Transport = {
  readonly name: string;
  send(to: string, message: Message): Promise<SendResult>;
};

/**
 * Writes to the log instead of sending.
 *
 * Used when no mail credentials are configured, so a missing setup is loud
 * and inspectable rather than silently dropping alerts on the floor.
 */
export const consoleTransport: Transport = {
  name: "console",
  async send(to, message) {
    console.log(`[notify:console] would send to ${to}: ${message.subject}`);
    return { ok: false, error: "Email delivery is not configured; the message was only logged" };
  },
};

/**
 * Gmail / Workspace SMTP.
 *
 * Uses an App Password rather than OAuth: the sign-in flow deliberately asks
 * for no mail scope, and a send-only credential that can be revoked on its own
 * is a smaller thing to hold than a token that can also read the mailbox.
 */
export function smtpTransport(): Transport | null {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!user || !pass) return null;

  const host = process.env.SMTP_HOST ?? "smtp.gmail.com";

  return {
    name: `smtp:${host}`,
    async send(to, message) {
      const { createTransport } = await import("nodemailer");
      const config = getSmtpConfig();
      const mailer = createTransport(config.options);
      return sendWithRetry(async () => {
        const result = await mailer.sendMail({
          from: config.from,
          replyTo: config.replyTo,
          to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          messageId: message.messageId,
        });
        assertSmtpAccepted(result);
      });
    },
  };
}

/** The transport to use, or the console when nothing is configured. */
export function activeTransport(): Transport {
  return smtpTransport() ?? consoleTransport;
}

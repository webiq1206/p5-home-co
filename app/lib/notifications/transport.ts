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
      try {
        const { createTransport } = await import("nodemailer");
        const config = getSmtpConfig();
        const mailer = createTransport(config.options);
        const result = await mailer.sendMail({
          from: config.from,
          replyTo: config.replyTo,
          to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        assertSmtpAccepted(result);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
  };
}

/** The transport to use, or the console when nothing is configured. */
export function activeTransport(): Transport {
  return smtpTransport() ?? consoleTransport;
}

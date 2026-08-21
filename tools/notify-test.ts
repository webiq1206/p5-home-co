/**
 * Send one test alert email, to prove the mail path works.
 *
 *   npm run notify:test -- you@p5homeco.com
 *
 * Uses the real transport, renderer and template, so a message arriving here
 * means a real alert would arrive too. Reads SMTP_* from the environment and
 * never prints the password.
 */

import { renderBundle } from "../app/lib/notifications/render.ts";
import type { Bundle } from "../app/lib/notifications/routing.ts";
import { activeTransport, smtpTransport } from "../app/lib/notifications/transport.ts";

async function main(): Promise<void> {
  const to = process.argv.find((a) => a.includes("@"));
  if (!to) {
    console.error('Usage: npm run notify:test -- you@p5homeco.com');
    process.exit(1);
  }

  const transport = activeTransport();
  if (!smtpTransport()) {
    console.error(
      "SMTP is not configured, so this would only write to the log.\n" +
        "Set SMTP_USER and SMTP_PASSWORD where the app runs, then try again.",
    );
    process.exit(1);
  }

  console.log(`Transport: ${transport.name}`);
  console.log(`Sending to: ${to}`);

  const now = new Date();
  const bundle: Bundle = {
    recipient: { userId: null, email: to, name: to.split("@")[0] },
    items: [
      {
        alertId: 0,
        dealId: 1,
        kind: "response_ceiling_breached",
        tier: "administrator",
        reason:
          "TEST MESSAGE — no one has contacted this lead yet. This is what a " +
          "real alert looks like; no action is needed.",
        clientName: "Test Lead (example)",
        brand: "P5 Home Co",
        raisedAt: now,
        receivedAt: new Date(now.getTime() - 9 * 60 * 60 * 1000),
        lastNotifiedAt: null,
        ownerEmail: to,
        ownerName: "You",
        ownerUserId: null,
      },
    ],
  };

  const message = renderBundle(
    bundle,
    (process.env.APP_BASE_URL ?? "https://p5homeco.com").replace(/\/+$/, ""),
    now,
  );
  console.log(`Subject:    ${message.subject}`);

  const result = await transport.send(to, message);
  if (result.ok) {
    console.log("\nSent. If it does not arrive within a minute, check spam.");
  } else {
    console.error(`\nFailed: ${result.error}`);
    if (/invalid login|username and password not accepted|535/i.test(result.error)) {
      console.error(
        "\nThat reads like a rejected credential. Two usual causes:\n" +
          "  - SMTP_PASSWORD must be the 16-character App Password, not the\n" +
          "    account password.\n" +
          "  - SMTP_USER must be the full address, e.g. hello@p5homeco.com",
      );
    }
    process.exit(1);
  }
}

await main();

// Makes this file a module, which top-level await requires.
export {};

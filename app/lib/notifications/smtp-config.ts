type Environment = Record<string, string | undefined>;

/** Shared server-only identity and TLS settings for both SMTP delivery paths. */
export function getSmtpConfig(env: Environment = process.env) {
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASSWORD;
  if (!user || !pass) throw new Error("Email delivery is not configured");
  const from = env.SMTP_FROM?.trim() || "P5 Home Co <hello@p5homeco.com>";
  const named = from.match(/^[^<>@\r\n]*<([^<>]+)>$/);
  const mailbox = (named ? named[1] : from).trim();
  if (/[\r\n]/.test(from) || !/^[^\s@<>,;]+@p5homeco\.com$/i.test(mailbox)) {
    throw new Error("SMTP_FROM must be one p5homeco.com mailbox");
  }
  const port = Number(env.SMTP_PORT || 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid SMTP_PORT");
  return {
    from,
    replyTo: "hello@p5homeco.com",
    options: {
      host: env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user, pass },
      connectionTimeout: 15_000,
      socketTimeout: 25_000,
    },
  };
}

export function assertSmtpAccepted(result: { accepted?: unknown[]; rejected?: unknown[] }): void {
  if (!result.accepted?.length || result.rejected?.length) {
    throw new Error("Email was not accepted for all recipients");
  }
}

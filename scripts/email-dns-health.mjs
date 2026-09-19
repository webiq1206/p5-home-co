// Read-only DNS checks. These do not send mail or establish inbox placement.
const DOMAIN = "p5homeco.com";
const RESEND = false;
let failures = 0;
async function lookup(name, type) {
  const response = await fetch("https://dns.google/resolve?name=" + encodeURIComponent(name) + "&type=" + type, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("DNS HTTP " + response.status);
  const result = await response.json();
  if (![0, 3].includes(result.Status)) throw new Error("DNS resolver status " + result.Status);
  return (result.Answer || []).filter(answer => answer.type === (type === "TXT" ? 16 : 15)).map(answer =>
    type === "TXT" ? answer.data.replace(/"\s*"/g, "").replace(/^"|"$/g, "") : answer.data
  );
}
async function check(name, type, description, valid) {
  try {
    const values = await lookup(name, type);
    if (!valid(values)) {
      failures++;
      console.error("FAIL " + description + " at " + name);
    } else console.log("PASS " + description + " at " + name);
  } catch (error) {
    failures++;
    console.error("UNKNOWN " + description + " at " + name + ": " + error.message);
  }
}
await Promise.all([
  check(DOMAIN, "TXT", "one Workspace SPF", values => {
    const records = values.filter(value => /^v=spf1(?:\s|$)/i.test(value));
    return records.length === 1 && records[0].split(/\s+/).includes("include:_spf.google.com");
  }),
  check("google._domainkey." + DOMAIN, "TXT", "Google DKIM", values =>
    values.length === 1 && /(?:^|;)\s*p=[A-Za-z0-9+/=]+/.test(values[0])),
  check("_dmarc." + DOMAIN, "TXT", "one DMARC record with aggregate reporting", values => {
    const records = values.filter(value => /^v=DMARC1;/i.test(value));
    return records.length === 1 && /(?:^|;)\s*p=(none|quarantine|reject)(?:;|$)/.test(records[0]) &&
      /(?:^|;)\s*rua=mailto:[^;\s]+/.test(records[0]);
  }),
  check(DOMAIN, "MX", "Workspace MX", values => values.some(value => /\s(?:smtp\.google\.com|(?:alt[1-4]\.)?aspmx\.l\.google\.com)\.?$/i.test(value))),
  ...(RESEND ? [
    check("resend._domainkey." + DOMAIN, "TXT", "Resend DKIM", values =>
      values.length === 1 && /(?:^|;)\s*p=[A-Za-z0-9+/=]+/.test(values[0])),
    check("send." + DOMAIN, "TXT", "Resend return-path SPF", values => {
      const records = values.filter(value => /^v=spf1(?:\s|$)/i.test(value));
      return records.length === 1 && records[0].split(/\s+/).includes("include:amazonses.com");
    }),
    check("send." + DOMAIN, "MX", "Resend feedback MX", values =>
      values.some(value => /\sfeedback-smtp\.[a-z0-9-]+\.amazonses\.com\.?$/i.test(value))),
  ] : []),
]);
console.log("DNS checks cannot verify Google Admin signing status, delivery, sender inventory, or a clean DMARC reporting period.");
process.exitCode = failures ? 1 : 0;

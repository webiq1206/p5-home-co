/** Administrator-only diagnostics retain useful errors, never credentials. */
export function metaDiagnostic(value: string | null, env: Record<string, string | undefined> = process.env): string | null {
  if (!value) return null;
  let text = value;
  for (const [name, secret] of Object.entries(env)) {
    if (secret && /(?:TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL)/i.test(name)) text = text.split(secret).join("[redacted]");
  }
  // Page override tokens may occur individually rather than as the whole JSON.
  try {
    for (const token of Object.values(JSON.parse(env.META_PAGE_TOKENS || "{}"))) {
      if (typeof token === "string" && token) text = text.split(token).join("[redacted]");
    }
  } catch { /* malformed configuration is not rendered */ }
  return text
    .replace(/\b(?:postgres(?:ql)?):\/\/[^\s"'<>]+/gi, "[redacted connection]")
    .replace(/(?:Bearer\s+|(?:access_token|token|password|api_key)[=:]\s*)[^\s"'&,]+/gi, "[redacted]")
    .replace(/\b(?:EAA[A-Za-z0-9]+|sk-[A-Za-z0-9_-]+)\b/g, "[redacted]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 2000);
}

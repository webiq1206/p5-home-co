import { MAILBOX, OWNER, PORTAL, email, phone, emailDirection, emailTimestamp, type Identity, type Mail } from "./inbox-policy.ts";
import { emailContent, htmlMatches, sourcePrefix } from "./inbox-content.ts";

type RecordResult = { id: string; archived?: boolean; properties: Record<string, string | null>; associations?: Record<string, { results: { id: string }[]; paging?: unknown }> };
type Results = { total: number; results: RecordResult[]; paging?: { next?: { after: string } } };
// Only constant route templates may leave the server. Never echo a URL,
// identifier, query, request body, token, or provider response/error text.
function safeRequest(path: string, method: string): string {
  const route = path.split("?", 1)[0];
  if (method === "GET") {
    if (route === "/account-info/v3/details") return "GET /account-info/v3/details";
    if (route === "/crm/v4/associations/emails/contacts/labels") return "GET /crm/v4/associations/emails/contacts/labels";
    if (/^\/crm\/v3\/owners\/[^/]+$/.test(route)) return "GET /crm/v3/owners/{ownerId}";
  }
  for (const object of ["emails", "contacts"] as const) {
    const base = `/crm/v3/objects/${object}`;
    if (route === base && (method === "GET" || method === "POST")) return `${method} ${base}`;
    if (route === `${base}/search` && method === "POST") return `POST ${base}/search`;
    if (method === "GET" && route.startsWith(`${base}/`) && !route.slice(base.length + 1).includes("/")) return `GET ${base}/{recordId}`;
  }
  return "unclassified-hubspot-request";
}
export class InboxApiError extends Error {
  status: number;
  request: string;
  constructor(status: number, path = "", method = "GET") {
    super(`hubspot-http-${status || "network"}`); this.status = status;
    this.request = safeRequest(path, method);
  }
}
export class InboxHubSpot {
  token: string; request: typeof fetch; deadline: number; lastRequest = 0;
  constructor(token: string, request: typeof fetch = fetch, deadline = Infinity) { this.token = token; this.request = request; this.deadline = deadline; }
  /** No automatic retries, no alternative API, and no response-body/secret logs. */
  async call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const delay = Math.max(0, this.lastRequest + 250 - Date.now());
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (Date.now() >= this.deadline) throw new Error("inbox-pass-budget-ended");
    this.lastRequest = Date.now();
    let response: Response;
    try {
      response = await this.request(`https://api.hubapi.com${path}`, { method,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(Math.max(1, Math.min(12_000, this.deadline - Date.now()))) });
    } catch { throw new InboxApiError(0, path, method); }
    if (!response.ok) throw new InboxApiError(response.status, path, method);
    return await response.json() as T;
  }
  async preflight() {
    const account = await this.call<{ portalId: number }>("/account-info/v3/details");
    if (Number(account.portalId) !== PORTAL) throw new Error("wrong-hubspot-portal");
    await this.call("/crm/v3/objects/emails?limit=1&properties=hs_email_message_id,hs_email_text,hs_email_headers");
    await this.call("/crm/v3/objects/emails/search", "POST", { filterGroups: [{ filters: [{ propertyName: "hs_email_message_id", operator: "EQ", value: "<p5-readiness-no-message@p5homeco.invalid>" }] }], limit: 1 });
    const owner = await this.call<{ id: string; email: string; archived: boolean }>(`/crm/v3/owners/${OWNER}`);
    if (owner.id !== OWNER || owner.email?.toLowerCase() !== MAILBOX || owner.archived) throw new Error("wrong-hubspot-owner");
    const labels = await this.call<{ results: { category: string; typeId: number }[] }>("/crm/v4/associations/emails/contacts/labels");
    if (!labels.results.some(x => x.category === "HUBSPOT_DEFINED" && x.typeId === 198)) throw new Error("email-association-unverified");
    await this.call("/crm/v3/objects/contacts?limit=1&properties=email,phone,mobilephone,hs_additional_emails");
  }
  async readEmail(id: string): Promise<RecordResult> {
    return this.call(`/crm/v3/objects/emails/${encodeURIComponent(id)}?properties=hs_email_message_id,hs_email_subject,hs_email_text,hs_email_html,hs_email_headers,hs_email_from_email,hs_email_to_email,hs_email_cc_email,hs_email_direction,hs_timestamp&associations=contacts,companies,deals,tickets`);
  }
  async findEmail(mail: Mail): Promise<RecordResult | null> {
    const matches = await this.call<Results>("/crm/v3/objects/emails/search", "POST", {
      filterGroups: [{ filters: [{ propertyName: "hs_email_message_id", operator: "EQ", value: mail.messageId }] }], limit: 3,
    });
    if (matches.total > 1 || matches.paging?.next) throw new Error("duplicate-crm-rfc-id");
    if (!matches.results.length) return null;
    return this.readExisting(matches.results[0].id, mail);
  }
  async readExisting(id: string, mail: Mail): Promise<RecordResult> {
    const record = await this.readEmail(id);
    if (record.properties.hs_email_message_id !== mail.messageId || record.properties.hs_email_subject !== mail.subject) throw new Error("crm-source-conflict");
    if (!headersMatch(record.properties, mail)) throw new Error("crm-header-conflict");
    if (emailDirection(mail) === "EMAIL" && (record.properties.hs_email_direction !== "EMAIL"
      || Date.parse(record.properties.hs_timestamp || "") !== Date.parse(emailTimestamp(mail)))) throw new Error("crm-sent-metadata-conflict");
    // Search result alone is never proof. A full read must return original
    // metadata and body content; existing native records are never overwritten.
    if (mail.text && !sourcePrefix(mail.text, record.properties.hs_email_text || "")) throw new Error("crm-body-conflict");
    if (mail.html && !htmlMatches(mail.html, record.properties.hs_email_html || "", true)) throw new Error("crm-body-conflict");
    return record;
  }
  async findContact(identity: Identity): Promise<string | null> {
    if (identity.kind === "email") {
      // Direct primary-email lookup avoids search indexing lag after creation.
      try {
        const direct = await this.call<RecordResult>(`/crm/v3/objects/contacts/${encodeURIComponent(identity.value)}?idProperty=email&properties=email,hs_additional_emails`);
        if (email(direct.properties.email || "") === identity.value) return direct.id;
      } catch (error) { if (!(error instanceof InboxApiError) || error.status !== 404) throw error; }
    }
    const query = identity.kind === "phone" ? identity.value.replace(/^\+1/, "") : identity.value;
    const found = await this.call<Results>("/crm/v3/objects/contacts/search", "POST", {
      query, properties: ["email", "hs_additional_emails", "phone", "mobilephone"], limit: 100,
    });
    if (found.paging?.next || found.total > 100) throw new Error("contact-search-incomplete");
    const exact = found.results.filter(row => identity.kind === "email"
      ? [row.properties.email, ...(row.properties.hs_additional_emails || "").split(";")].some(v => email(v || "") === identity.value)
      : [row.properties.phone, row.properties.mobilephone].some(v => phone(v || "") === identity.value));
    if (exact.length > 1) throw new Error("ambiguous-contact");
    if (exact.length) return exact[0].id;
    if (identity.kind !== "email" || !identity.create) return null;
    // Only a trusted website's explicit customer email can create a contact.
    // Email uniqueness prevents duplicate contacts if a response is lost.
    const created = await this.call<RecordResult>("/crm/v3/objects/contacts", "POST", { properties: { email: identity.value } });
    return created.id;
  }
  async createEmail(mail: Mail, contactId: string | null, sourceId: string): Promise<string> {
    // Preserve the complete display name without guessing given/family parts.
    const address = (a: { email: string; name: string }) => ({ email: a.email, firstName: a.name });
    const content = emailContent(mail, sourceId);
    const properties = {
      hs_email_message_id: mail.messageId, hs_timestamp: emailTimestamp(mail),
      hs_email_subject: mail.subject, hs_email_text: content.text, hs_email_html: content.html,
      hs_email_status: "SENT", hs_email_direction: emailDirection(mail), hubspot_owner_id: OWNER,
      hs_email_headers: JSON.stringify({ from: address(mail.from[0]), to: mail.to.map(address), cc: mail.cc.map(address), bcc: (mail.bcc || []).map(address) }),
    };
    const result = await this.call<{ id: string }>("/crm/v3/objects/emails", "POST", { properties,
      associations: contactId ? [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 198 }] }] : [] });
    return result.id;
  }
  async verify(id: string, mail: Mail, contactId: string | null, sourceId: string) {
    const record = await this.readEmail(id), p = record.properties;
    const content = emailContent(mail, sourceId);
    if (p.hs_email_message_id !== mail.messageId || p.hs_email_subject !== mail.subject || (p.hs_email_text || "") !== content.text
      || !htmlMatches(content.html, p.hs_email_html || "")
      || p.hs_email_direction !== emailDirection(mail)
      || Date.parse(p.hs_timestamp || "") !== Date.parse(emailTimestamp(mail))) throw new Error("created-email-readback-mismatch");
    if (!headersMatch(p, mail)) throw new Error("created-email-header-mismatch");
    const contacts = [...new Set(record.associations?.contacts?.results.map(x => x.id) || [])].sort();
    if (JSON.stringify(contacts) !== JSON.stringify(contactId ? [contactId] : [])) throw new Error("created-email-contact-mismatch");
    if (Object.entries(record.associations || {}).some(([kind, data]) => data.paging || (!["contacts", "companies"].includes(kind) && data.results.length))) throw new Error("unexpected-email-association");
    const companies = [...new Set(record.associations?.companies?.results.map(x => x.id) || [])];
    if (companies.length) {
      if (!contactId) throw new Error("unexpected-email-association");
      // HubSpot can add the contact's companies during EMAIL creation. Accept
      // only freshly read relationships of this exact contact, not a domain
      // guess or a company inherited from another native activity.
      const contact = await this.call<RecordResult>(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?properties=email&associations=companies`);
      const linked = contact.associations?.companies;
      if (contact.id !== contactId || contact.archived || linked?.paging
        || companies.some(id => !linked?.results.some(company => company.id === id))) throw new Error("unexpected-email-association");
    }
  }
}

function headersMatch(properties: Record<string, string | null>, mail: Mail) {
  const addresses = (value: string | null | undefined) => [...new Set((value || "").toLowerCase().match(/[^\s<>,;]+@[^\s<>,;]+/g) || [])].sort();
  let bcc: string[];
  try {
    const headers = JSON.parse(properties.hs_email_headers || "{}");
    if (headers.bcc !== undefined && !Array.isArray(headers.bcc)) return false;
    bcc = [...new Set((headers.bcc || []).map((a: { email?: string }) => String(a.email || "").toLowerCase()))].sort() as string[];
  } catch { return false; }
  return JSON.stringify(addresses(properties.hs_email_from_email)) === JSON.stringify(mail.from.map(a => a.email).sort())
    && JSON.stringify(addresses(properties.hs_email_to_email)) === JSON.stringify([...new Set(mail.to.map(a => a.email))].sort())
    && JSON.stringify(addresses(properties.hs_email_cc_email)) === JSON.stringify([...new Set(mail.cc.map(a => a.email))].sort())
    && JSON.stringify(bcc) === JSON.stringify([...new Set((mail.bcc || []).map(a => a.email))].sort());
}

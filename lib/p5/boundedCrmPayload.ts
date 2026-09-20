const CRM_JSON_LIMIT_BYTES = 100 * 1024;
// Keep headroom for proxies which may account for the body differently.
export const CRM_PAYLOAD_LIMIT_BYTES = 90_000;
export const CRM_RESPONSE_LIMIT_BYTES = 64 * 1024;

type JsonRecord = Record<string, any>;

const REDUNDANT_INTERNAL_FIELDS: Record<string, string> = {
  scopePricing: "full pricing research and traces retained in the authenticated durable draft",
  costBookSnapshot: "policy evidence retained in the authenticated durable draft",
  financeSnapshot: "policy evidence retained in the authenticated durable draft",
};

export class CrmPayloadTooLargeError extends Error {
  // A declared field, not a parameter property: the engine runs under type stripping.
  readonly payloadBytes: number;
  constructor(payloadBytes: number) {
    super(`CRM payload exceeds safe limit (payloadBytes=${payloadBytes}, payloadLimit=${CRM_PAYLOAD_LIMIT_BYTES})`);
    this.payloadBytes = payloadBytes;
    this.name = "CrmPayloadTooLargeError";
  }
}

function requireRecord(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`CRM payload cannot be built: ${path} is missing`);
  }
  return value as JsonRecord;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`CRM payload cannot be built: ${path} is missing`);
  }
  return value;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left)===JSON.stringify(right);
}

function compactInternal(internal: JsonRecord, scope: JsonRecord) {
  const compact = {...internal};
  const omittedRedundantMetadata: {path:string;reason:string;count?:number}[] = Object.entries(REDUNDANT_INTERNAL_FIELDS)
    .filter(([field]) => field in compact)
    .map(([field, reason]) => {
      delete compact[field];
      return {path: `internal.${field}`, reason};
    });
  if ("scope" in compact && sameJson(compact.scope,scope)) {
    delete compact.scope;
    omittedRedundantMetadata.push({path:"internal.scope",reason:"byte-identical to estimate.scope"});
  }

  // Cost-book references and quantity narratives are repeated across the
  // snapshot, scope-pricing evidence, and priced lines. Keep every priced line
  // and its concise provenance, but retain the long source prose once in the
  // unchanged durable draft rather than repeatedly in the CRM copy.
  let evidenceReferences=0,quantitySources=0;
  if (Array.isArray(compact.lines)) compact.lines=compact.lines.map((value:any)=>{
    if (!value || typeof value!=="object" || Array.isArray(value)) return value;
    const line={...value};
    if (line.evidence && typeof line.evidence==="object" && typeof line.evidence.reference==="string") {
      const {reference,...evidence}=line.evidence;
      line.evidence=evidence;evidenceReferences++;
    }
    if (typeof line.quantitySource==="string") {
      delete line.quantitySource;quantitySources++;
    }
    return line;
  });
  if(evidenceReferences)omittedRedundantMetadata.push({path:"internal.lines[*].evidence.reference",reason:"long source prose duplicated by cost-book/scope-pricing evidence and retained in the authenticated durable draft",count:evidenceReferences});
  if(quantitySources)omittedRedundantMetadata.push({path:"internal.lines[*].quantitySource",reason:"long quantity-source prose duplicated by scope-pricing tasks and retained in the authenticated durable draft",count:quantitySources});
  return {compact, omittedRedundantMetadata};
}

function trustedDomain(value: unknown) {
  const domain=requireString(value,"configuredDomain").toLowerCase();
  if(domain.length>253||!(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain))){
    throw new Error("CRM payload cannot be built: configuredDomain is not a valid hostname");
  }
  return domain;
}

/**
 * Where an authenticated administrator opens the saved record. The page
 * accepts ?id=&revision= deep links; the API route returns the same record as
 * JSON and is the default, because it resolves on every site whether or not
 * its admin page handles the deep link. crmPayload.ts selects the page for a
 * brand whose page does. Both require normal administrator authentication.
 */
export const CRM_ADMIN_PAGE_PATH = "/admin/p5-estimators";
export const CRM_ADMIN_API_PATH = "/api/admin/p5-estimators";
export type CrmAdminPath = typeof CRM_ADMIN_PAGE_PATH | typeof CRM_ADMIN_API_PATH;
export interface CrmPayloadOptions { adminPath?: CrmAdminPath }

function trustedAdminPath(value: unknown): CrmAdminPath {
  if (value === undefined) return CRM_ADMIN_API_PATH;
  if (value !== CRM_ADMIN_PAGE_PATH && value !== CRM_ADMIN_API_PATH) {
    throw new Error("CRM payload cannot be built: adminPath is not an estimator administrator route");
  }
  return value;
}

function adminDraftUrl(domain: string, draftId: string, adminPath: CrmAdminPath) {
  const url = new URL(`https://${domain}${adminPath}`);
  url.searchParams.set("id", draftId);
  return url;
}

function revisionAdminDraftUrl(domain: string, draftId: string, revision: unknown, adminPath: CrmAdminPath) {
  const url = adminDraftUrl(domain, draftId, adminPath);
  url.searchParams.set("revision", String(revision));
  return url.toString();
}

function referencePayload(source: JsonRecord, fields: {
  domain: string;
  adminPath: CrmAdminPath;
  draftId: string;
  fullName: string;
  email: string;
  service: string;
  summary: string;
  answers: JsonRecord;
  range: JsonRecord;
  key: string;
  compactBytes: number;
}) {
  const summaryExcerpt = fields.summary.slice(0, 1_900);
  const url = revisionAdminDraftUrl(fields.domain, fields.draftId, source.revision, fields.adminPath);
  const omittedPaths = ["estimate.scope", "estimate.internal", "estimate.customer"];
  return {
    fullName: fields.fullName,
    email: fields.email,
    phone: source.contact.phone || undefined,
    source: fields.domain,
    // The receiver binds this durable estimate identity to the idempotency key.
    externalLeadId: fields.key,
    inquiryId: fields.draftId,
    propertyAddress: fields.answers.address || undefined,
    city: fields.answers.location || undefined,
    projectTypes: [fields.service],
    projectScope: summaryExcerpt,
    estimate: {
      schemaVersion: 1,
      mode: "authenticated-reference",
      referenceMode: true,
      brand: source.brand,
      estimator: source.estimator,
      id: fields.draftId,
      revision: source.revision,
      sourceIdentity: {
        domain: fields.domain,
        externalLeadId: fields.key,
        inquiryId: fields.draftId,
      },
      lead: {
        fullName: fields.fullName,
        email: fields.email,
        phone: source.contact.phone || undefined,
        source: fields.domain,
      },
      project: {
        service: fields.service,
        propertyAddress: fields.answers.address || undefined,
        city: fields.answers.location || undefined,
        summaryExcerpt,
        summaryCharacters: fields.summary.length,
        summaryComplete: summaryExcerpt.length === fields.summary.length,
      },
      sellingRange: {low: fields.range.low, high: fields.range.high},
      durableAdminRecord: {
        draftId: fields.draftId,
        revision: source.revision,
        url,
        access: "authenticated administrator",
        note: "Normal administrator authentication is required. This reference grants no public access.",
      },
      manifest: {
        label: "REFERENCE_MODE_COMPACT_ESTIMATE_EXCEEDED_CRM_BOUND",
        mode: "authenticated-reference",
        reason: `The legitimate compact CRM estimate was ${fields.compactBytes} UTF-8 bytes, above the ${CRM_PAYLOAD_LIMIT_BYTES}-byte sender bound.`,
        omittedPaths,
        omittedContent: "Complete scope, customer presentation, internal pricing, and evidence remain in the unchanged durable draft and outbox record.",
        summaryExcerpt: summaryExcerpt.length === fields.summary.length ? "complete" : "explicitly excerpted",
      },
    },
    estimateSummary: `REFERENCE MODE: estimate ${fields.draftId}, revision ${source.revision}. ${summaryExcerpt} Selling range: $${fields.range.low} to $${fields.range.high}. Full unchanged detail requires normal administrator authentication at ${url}. Full estimate sections omitted from this bounded envelope: ${omittedPaths.join(", ")}.`,
    estimateLow: fields.range.low,
    estimateHigh: fields.range.high,
    estimateRange: fields.range.low != null && fields.range.high != null ? `$${fields.range.low} to $${fields.range.high}` : undefined,
  };
}

export function crmPayloadBytes(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

export async function readBoundedCrmResponse(response: Response) {
  if(!response.body)return {text:"",bytes:0,oversized:false};
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
  while(true){
    const {done,value}=await reader.read();if(done)break;
    bytes+=value.byteLength;
    if(bytes>CRM_RESPONSE_LIMIT_BYTES){
      await reader.cancel().catch(()=>undefined);
      return {text:"",bytes,oversized:true};
    }
    chunks.push(value);
  }
  const joined=new Uint8Array(bytes);let offset=0;
  for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
  return {text:new TextDecoder().decode(joined),bytes,oversized:false};
}

const SAFE_RESPONSE_KEYS=new Set(["success","accepted","duplicate","leadId","id","lead","dealId","error","code","message"]);
export function safeCrmResponseShape(value: unknown) {
  if(!value||typeof value!=="object"||Array.isArray(value))return "non-json";
  const keys=Object.keys(value).filter(key=>SAFE_RESPONSE_KEYS.has(key)).sort();
  return `json:${keys.join(",")||"no-ack-keys"}`;
}

export function safeCrmContentClass(contentType: string|null) {
  const value=(contentType||"").toLowerCase();
  if(value.includes("application/json")||value.includes("+json"))return "json";
  if(value.startsWith("text/"))return "text";
  return value?"other":"missing";
}

/**
 * Produces a receiver-compatible copy while leaving the durable outbox record
 * untouched. When the complete useful copy fits, only duplicated
 * policy/evidence snapshots are represented by a manifest. If that legitimate
 * compact copy is still too large, a visibly labelled reference envelope is
 * sent instead; it contains identity, source, revision, summary and selling
 * range, and points administrators to the complete authenticated record.
 */
export function buildCrmPayload(record: unknown, key: string, configuredDomain: string, options: CrmPayloadOptions = {}) {
  const adminPath = trustedAdminPath(options.adminPath);
  const source = requireRecord(record, "record");
  const contact = requireRecord(source.contact, "contact");
  const scope = requireRecord(source.scope, "scope");
  const answers = requireRecord(scope.answers, "scope.answers");
  const customer = requireRecord(source.customer, "customer");
  const internal = requireRecord(source.internal, "internal");
  const draftId = requireString(source.draftId, "draftId");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(draftId)) {
    throw new Error("CRM payload cannot be built: draftId must identify a saved estimate");
  }
  if (!Number.isSafeInteger(source.revision) || source.revision < 1) {
    throw new Error("CRM payload cannot be built: revision is missing");
  }
  const fullName = requireString(contact.name, "contact.name");
  const email = requireString(contact.email, "contact.email");
  for(const [field,value,max] of [
    ['fullName',fullName,255],['email',email,255],['phone',contact.phone,50],
    ['propertyAddress',answers.address,500],['city',answers.location,100],
  ] as const){
    if(value!==undefined&&value!==null&&(typeof value!=='string'||value.length>max))
      throw new Error(`CRM field ${field} exceeds the accepted limit; no customer identity was truncated`);
  }
  const summary = requireString(customer.summary, "customer.summary");
  const service = requireString(answers.service, "scope.answers.service");
  if (!Array.isArray(internal.lines) || !internal.lines.length) {
    throw new Error("CRM payload cannot be built: internal.lines is missing");
  }

  const domain = trustedDomain(configuredDomain);
  const {compact, omittedRedundantMetadata} = compactInternal(internal,scope);
  const adminUrl = revisionAdminDraftUrl(domain, draftId, source.revision, adminPath);
  const range = requireRecord(customer.range, "customer.range");
  const estimate = {
    schemaVersion: 1,
    brand: source.brand,
    estimator: source.estimator,
    id: draftId,
    revision: source.revision,
    scope,
    internal: compact,
    customer,
    durableAdminRecord: {
      draftId,
      url: adminUrl,
      access: "authenticated administrator",
      note: "The complete original outbox payload and internal draft are retained here.",
    },
    omittedRedundantMetadata,
  };
  const omittedPaths = omittedRedundantMetadata.map(item => item.path).join(", ");
  const payload = {
    fullName,
    email,
    phone: contact.phone || undefined,
    source: domain,
    externalLeadId: key,
    inquiryId: draftId,
    propertyAddress: answers.address || undefined,
    city: answers.location || undefined,
    projectTypes: [service],
    // The complete summary remains in estimate.customer; this field has a
    // receiver-enforced 2,000-character limit.
    projectScope: summary.slice(0, 1_900),
    estimate,
    estimateSummary: `Administrative estimate ${draftId}. Complete durable record: ${adminUrl}. CRM copy omits redundant metadata: ${omittedPaths || "none"}.`,
    estimateLow: range.low,
    estimateHigh: range.high,
    estimateRange: range.low != null && range.high != null ? `$${range.low} to $${range.high}` : undefined,
  };
  const bytes = crmPayloadBytes(payload);
  if (bytes > CRM_PAYLOAD_LIMIT_BYTES) {
    const reference = referencePayload(source, {
      domain, adminPath, draftId, fullName, email, service, summary, answers, range, key,
      compactBytes: bytes,
    });
    const referenceBytes = crmPayloadBytes(reference);
    if (referenceBytes > CRM_PAYLOAD_LIMIT_BYTES) throw new CrmPayloadTooLargeError(referenceBytes);
    return reference;
  }
  return payload;
}

export const CRM_RECEIVER_PARSER_LIMIT_BYTES = CRM_JSON_LIMIT_BYTES;
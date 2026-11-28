export type Capability = { division: string; trade: string; keywords: string[]; verified: boolean };
export type ContractorFields = {
  company: string; contact: string; phone: string; email: string; serviceArea: string;
  capabilities: Capability[]; history: string; pricingNotes: string;
};
export type Identity = Pick<ContractorFields,"company"|"phone"|"email">;

export class ContractorStoreError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status=status; }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function field(value: unknown, size: number, label: string, multiline = false): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > size || (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) {
    throw new ContractorStoreError("Invalid " + label + ".", 400);
  }
  return value.trim();
}
export function companyKey(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
export function phoneKey(phone: string): string {
  const match = phone.trim().match(/^(.+?)(?:\s*(?:ext\.?|x)\s*\d{1,8})?$/i);
  const digits = (match?.[1] ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
}
function emailKey(email: string): string { return email.trim().toLowerCase(); }

export function contractorFields(value: unknown, fallback?: ContractorFields): ContractorFields {
  if (!isRecord(value)) throw new ContractorStoreError("Enter contractor details.", 400);
  const pick = <K extends keyof ContractorFields>(key: K) => Object.hasOwn(value,key) ? value[key] : fallback?.[key];
  const company = field(pick("company"),200,"company");
  if (!companyKey(company)) throw new ContractorStoreError("Enter a company name.", 400);
  const contact = field(pick("contact"),200,"primary contact");
  const phone = field(pick("phone"),48,"phone");
  if (phone && (!/^\+?[\d().\-\s]+(?:\s*(?:ext\.?|x)\s*\d{1,8})?$/i.test(phone) || phoneKey(phone).length < 7 || phoneKey(phone).length > 15)) {
    throw new ContractorStoreError("Enter a valid phone number.",400);
  }
  const email = field(pick("email"),254,"email").toLowerCase();
  if (email && !/^([a-z0-9_+.!-]+)@([a-z0-9-]+\.)+[a-z0-9-]+$/i.test(email)) {
    throw new ContractorStoreError("Enter a valid email address.",400);
  }
  const serviceArea = field(pick("serviceArea"),1000,"service area",true);
  const history = field(pick("history"),12000,"history",true);
  const pricingNotes = field(pick("pricingNotes"),12000,"pricing notes",true);
  const raw = pick("capabilities") ?? [];
  if (!Array.isArray(raw) || raw.length > 50) throw new ContractorStoreError("Enter up to 50 capabilities.",400);
  const capabilities: Capability[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry)) throw new ContractorStoreError("Invalid capability.",400);
    const division = field(entry.division,96,"division");
    const trade = field(entry.trade,160,"trade");
    if (!division || !trade) throw new ContractorStoreError("A capability needs a division and a trade.",400);
    const keywordsRaw = entry.keywords ?? [];
    if (!Array.isArray(keywordsRaw) || keywordsRaw.length > 30) throw new ContractorStoreError("Enter up to 30 keywords per capability.",400);
    const keywords = [...new Set(keywordsRaw.map(x=>field(x,100,"capability keyword")).filter(Boolean))];
    if (entry.verified !== undefined && typeof entry.verified !== "boolean") throw new ContractorStoreError("Invalid capability verification.",400);
    const key = JSON.stringify([companyKey(division),companyKey(trade),keywords.map(companyKey).sort()]);
    if (seen.has(key)) throw new ContractorStoreError("Repeated capabilities must be combined.",400);
    seen.add(key);
    capabilities.push({division,trade,keywords,verified:entry.verified === true});
  }
  return {company,contact,phone,email,serviceArea,capabilities,history,pricingNotes};
}

export function compareIdentity(a:Identity,b:Identity): "exact"|"review"|"none" {
  const nameA=companyKey(a.company), nameB=companyKey(b.company);
  const name=!!nameA && nameA===nameB;
  const eA=emailKey(a.email), eB=emailKey(b.email), pA=phoneKey(a.phone), pB=phoneKey(b.phone);
  const email=!!eA && eA===eB, phone=pA.length>=7 && pA===pB;
  const conflicts=(eA && eB && !email) || (pA.length>=7 && pB.length>=7 && !phone);
  if (name && (email || phone) && !conflicts) return "exact";
  return name || email || phone ? "review" : "none";
}

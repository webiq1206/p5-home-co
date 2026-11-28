import type { ReactNode } from "react";

export type Capability = { division: string; trade: string; keywords: string[]; verified: boolean };
export type ContractorProfile = {
  id: number;
  company: string;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  serviceArea?: string | null;
  capabilities: Capability[];
  history?: string | string[] | null;
  pricingNotes?: string | null;
  qboVendorId?: string | null;
  qboVendorUrl?: string | null;
  hubspotCompanyId?: string | null;
  hubspotContactId?: string | null;
};

export function ActionLinks({person}: {person: Pick<ContractorProfile,"contact"|"phone"|"email">}) {
  const number = person.phone?.match(/^\s*(\+?[0-9().\-\s]+)(?:\s*(?:x|ext\.?)\s*(\d{1,8}))?\s*$/i);
  const dial = number?.[1]?.replace(/[^+0-9]/g, "");
  const phoneLink = dial && /^\+?[0-9]{7,15}$/.test(dial)
    ? 'tel:' + dial + (number?.[2] ? ';ext=' + number[2] : '') : null;
  const email = person.email?.trim();
  const mail = email && /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(email) ? 'mailto:' + encodeURIComponent(email).replace(/%40/g, "@") : null;
  return <div className="ct-contact">
    {person.contact && <span className="ct-contact-name">{person.contact}</span>}
    {phoneLink && <a className="lead-action" href={phoneLink} aria-label={'Call ' + (person.contact || person.phone)}>{person.phone}</a>}
    {mail && <a className="lead-action" href={mail} aria-label={'Email ' + (person.contact || email)}>{email}</a>}
    {!phoneLink && !mail && <span className="ct-muted">No verified dialable contact on file</span>}
  </div>;
}

const numericId = (value?: string | null) => value && /^\d+$/.test(String(value)) ? String(value) : null;
const isVendorUrl = (value?: string | null) => {
  if (!value) return false;
  try {const url = new URL(value); return url.origin === "https://qbo.intuit.com" && url.pathname === "/app/vendordetail";}
  catch {return false;}
};

export function SystemLinks({person}: {person: ContractorProfile}) {
  const company = numericId(person.hubspotCompanyId);
  const contact = numericId(person.hubspotContactId);
  const qboId = numericId(person.qboVendorId);
  const directQboLink = qboId && person.qboVendorUrl && isVendorUrl(person.qboVendorUrl) && new URL(person.qboVendorUrl).searchParams.get("nameId") === qboId ? person.qboVendorUrl : null;
  return <div className="ct-contact">
    {directQboLink ? <a className="lead-action" href={directQboLink} target="_blank" rel="noreferrer">QuickBooks vendor {qboId}</a>
      : qboId ? <a className="lead-action" href="/admin/finance/vendors">P5 vendor records · QBO ID {qboId}</a>
      : <span className="ct-muted">QuickBooks not linked</span>}
    {company && <a className="lead-action" href={'https://app-na2.hubspot.com/contacts/247066159/record/0-2/' + company} target="_blank" rel="noreferrer">HubSpot company</a>}
    {contact && <a className="lead-action" href={'https://app-na2.hubspot.com/contacts/247066159/record/0-1/' + contact} target="_blank" rel="noreferrer">HubSpot contact</a>}
    {!company && !contact && <span className="ct-muted">HubSpot not linked</span>}
  </div>;
}

export function Notice({children, type="status"}: {children: ReactNode; type?: "status"|"alert"}) {
  return <p className={'ct-notice' + (type === "alert" ? ' ct-notice-error' : '')} role={type}>{children}</p>;
}

export async function contractorRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/api/admin/contractors' + path, {
    cache: "no-store",
    ...init,
  });
  const body = await res.json().catch(() => null) as {ok?: boolean; error?: unknown} | null;
  if (!res.ok || !body || body.ok === false) {
    if (res.status === 401 || res.status === 403) throw new Error("Your session or role does not allow this action. Sign in with an authorized P5 account.");
    throw new Error(typeof body?.error === "string" ? body.error : "Could not complete the request. Try again.");
  }
  return body as T;
}

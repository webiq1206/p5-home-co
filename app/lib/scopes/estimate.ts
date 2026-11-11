/**
 * QuickBooks estimate shape, status labels and change detection. Pure, so the
 * exact payload and every label can be tested without QuickBooks.
 *
 * Status labels use only what the QuickBooks Online Estimate object exposes
 * through the accounting API: TxnStatus (Pending, Accepted, Closed, Rejected),
 * EmailStatus (NotSet, NeedToSend, EmailSent), AcceptedBy / AcceptedDate and
 * LinkedTxn (an Invoice created from the estimate). Nothing else is claimed.
 */

import { divisionLabel, phaseName, groupByPhaseDivision } from "./divisions.ts";
import type { EstimateLine, ItemKey, PricingResult } from "./types.ts";

export type QboLine = {
  DetailType: "SalesItemLineDetail" | "DescriptionOnly";
  Description: string;
  Amount?: number;
  SalesItemLineDetail?: {
    ItemRef: { value: string; name?: string };
    Qty: number;
    UnitPrice: number;
    TaxCodeRef?: { value: string };
  };
  DescriptionLineDetail?: Record<string, never>;
};

export type EstimatePayload = {
  CustomerRef: { value: string };
  Line: QboLine[];
  CustomerMemo?: { value: string };
  PrivateNote: string;
  EmailStatus: "NotSet";
  BillEmail?: { Address: string };
  BillAddr?: { Line1: string };
  ShipAddr?: { Line1: string };
  Id?: string;
  SyncToken?: string;
  sparse?: false;
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function buildEstimatePayload(input: {
  customerId: string;
  pricing: PricingResult;
  itemIds: Record<ItemKey, string>;
  taxable: ItemKey[];
  email?: string | null;
  billingAddress?: string | null;
  projectAddress?: string | null;
  exclusions: string[];
  privateNote: string;
}): EstimatePayload {
  const base = input.pricing.lines.filter((l) => !l.optional);
  const optional = input.pricing.lines.filter((l) => l.optional);
  const Line: QboLine[] = [];
  for (const group of groupByPhaseDivision(base)) {
    Line.push({ DetailType: "DescriptionOnly", Description: phaseName(group.phase), DescriptionLineDetail: {} });
    for (const div of group.divisions) {
      Line.push({ DetailType: "DescriptionOnly", Description: `Division ${divisionLabel(div.code)}`, DescriptionLineDetail: {} });
      for (const l of div.items) Line.push(salesLine(l, input.itemIds, input.taxable));
    }
  }
  const memo: string[] = [];
  if (optional.length) {
    memo.push("Optional upgrades, not included in the total:");
    for (const l of optional) memo.push(`- ${l.description}: ${money(l.price)}`);
  }
  if (input.exclusions.length) memo.push(`Not included: ${input.exclusions.join("; ")}.`);
  return {
    CustomerRef: { value: input.customerId },
    Line,
    ...(memo.length ? { CustomerMemo: { value: clip(memo.join("\n"), 1000) } } : {}),
    PrivateNote: clip(input.privateNote, 4000),
    EmailStatus: "NotSet",
    ...(input.email ? { BillEmail: { Address: input.email } } : {}),
    ...(input.billingAddress || input.projectAddress
      ? { BillAddr: { Line1: clip((input.billingAddress || input.projectAddress)!, 500) } }
      : {}),
    ...(input.projectAddress ? { ShipAddr: { Line1: clip(input.projectAddress, 500) } } : {}),
  };
}

function salesLine(l: EstimateLine, itemIds: Record<ItemKey, string>, taxable: ItemKey[]): QboLine {
  return {
    DetailType: "SalesItemLineDetail",
    Description: clip(l.description, 4000),
    Amount: l.price,
    SalesItemLineDetail: {
      ItemRef: { value: itemIds[l.item], name: l.item },
      Qty: l.quantity,
      UnitPrice: l.unitPrice,
      TaxCodeRef: { value: taxable.includes(l.item) ? "TAX" : "NON" },
    },
  };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type EstimateStatusName =
  | "not_created"
  | "created_unsent"
  | "sent"
  | "accepted"
  | "declined"
  | "closed"
  | "converted"
  | "unavailable";

export const ESTIMATE_STATUS_LABEL: Record<EstimateStatusName, string> = {
  not_created: "Not created",
  created_unsent: "In QuickBooks, not sent",
  sent: "Sent, awaiting response",
  accepted: "Accepted",
  declined: "Declined",
  closed: "Closed",
  converted: "Invoiced",
  unavailable: "Status unavailable",
};

type RawEstimate = {
  TxnStatus?: string;
  EmailStatus?: string;
  AcceptedBy?: string;
  AcceptedDate?: string;
  LinkedTxn?: { TxnId: string; TxnType: string }[];
};

export function estimateStatus(raw: RawEstimate | null | undefined, exists: boolean): EstimateStatusName {
  if (!exists) return "not_created";
  if (!raw || !raw.TxnStatus) return "unavailable";
  if (raw.LinkedTxn?.some((t) => t.TxnType === "Invoice")) return "converted";
  switch (raw.TxnStatus) {
    case "Accepted":
      return "accepted";
    case "Rejected":
      return "declined";
    case "Closed":
      return "closed";
    case "Pending":
      return raw.EmailStatus === "EmailSent" ? "sent" : "created_unsent";
    default:
      return "unavailable";
  }
}

// ---------------------------------------------------------------------------
// Changes made directly in QuickBooks
// ---------------------------------------------------------------------------

type ComparableLine = { d: string; q: number; p: number; a: number };

function salesLines(lines: unknown): ComparableLine[] {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((l) => l && l.DetailType === "SalesItemLineDetail")
    .map((l) => ({
      d: String(l.Description ?? "").trim(),
      q: Number(l.SalesItemLineDetail?.Qty ?? 0),
      p: Number(l.SalesItemLineDetail?.UnitPrice ?? 0),
      a: Math.round(Number(l.Amount ?? 0) * 100) / 100,
    }));
}

export type Drift = { changed: boolean; sentTotal: number; currentTotal: number; details: string[] };

/** Compare what P5 sent with what QuickBooks holds now. */
export function compareEstimate(sent: { Line: unknown }, current: { Line?: unknown; TotalAmt?: number }): Drift {
  const a = salesLines(sent.Line);
  const b = salesLines(current.Line);
  const sentTotal = Math.round(a.reduce((s, l) => s + l.a, 0) * 100) / 100;
  const currentLinesTotal = Math.round(b.reduce((s, l) => s + l.a, 0) * 100) / 100;
  const details: string[] = [];
  const key = (l: ComparableLine) => l.d.toLowerCase();
  const inB = new Map(b.map((l) => [key(l), l]));
  const inA = new Map(a.map((l) => [key(l), l]));
  for (const l of a) {
    const m = inB.get(key(l));
    if (!m) details.push(`Removed or renamed in QuickBooks: "${l.d}" (${money(l.a)})`);
    else if (m.q !== l.q || m.p !== l.p || m.a !== l.a) {
      details.push(`Changed in QuickBooks: "${l.d}" from ${l.q} x ${money(l.p)} = ${money(l.a)} to ${m.q} x ${money(m.p)} = ${money(m.a)}`);
    }
  }
  for (const l of b) if (!inA.has(key(l))) details.push(`Added in QuickBooks: "${l.d}" (${money(l.a)})`);
  if (Math.abs(currentLinesTotal - sentTotal) >= 0.01) {
    details.push(`Line total changed from ${money(sentTotal)} to ${money(currentLinesTotal)}`);
  }
  return {
    changed: details.length > 0,
    sentTotal,
    currentTotal: typeof current.TotalAmt === "number" ? current.TotalAmt : currentLinesTotal,
    details,
  };
}

export function qboWebUrl(kind: "estimate" | "customer", id: string, sandbox: boolean): string {
  const host = sandbox ? "https://app.sandbox.qbo.intuit.com" : "https://qbo.intuit.com";
  return kind === "estimate" ? `${host}/app/estimate?txnId=${encodeURIComponent(id)}` : `${host}/app/customerdetail?nameId=${encodeURIComponent(id)}`;
}

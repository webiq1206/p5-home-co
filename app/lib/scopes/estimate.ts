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
  sparse?: true;
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
    // Headings are capitals so the breaks are easy to scan. QuickBooks stores
    // plain text only, so bold is not available, and it decides on its own how a
    // text-only row prints (its current layout shows a quantity and $0.00).
    Line.push({ DetailType: "DescriptionOnly", Description: phaseName(group.phase).toUpperCase(), DescriptionLineDetail: {} });
    for (const div of group.divisions) {
      Line.push({ DetailType: "DescriptionOnly", Description: `Division ${divisionLabel(div.code)}`.toUpperCase(), DescriptionLineDetail: {} });
      for (const l of div.items) Line.push(salesLine(l, input.itemIds, input.taxable));
    }
  }
  const memo: string[] = [];
  if (optional.length) {
    memo.push("Optional upgrades, not included in the total:");
    for (const l of optional) memo.push(`- ${l.title || l.description}: ${money(l.price)}`);
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

/**
 * What the client reads for a line. QuickBooks titles every line with its
 * product or service item ("Subcontractor Work"), which says nothing about the
 * job, so the work's own name leads the description on a line of its own.
 */
export function lineText(l: Pick<EstimateLine, "title" | "description">): string {
  const title = (l.title ?? "").trim();
  if (!title) return l.description;
  // Do not repeat a title the description already opens with.
  const plain = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (plain(l.description).startsWith(plain(title))) return l.description;
  // The room is already in the title: do not say it again on the next line.
  const cut = title.indexOf(": ");
  const room = cut > 0 ? title.slice(0, cut + 2) : "";
  const body = room && l.description.toLowerCase().startsWith(room.toLowerCase()) ? l.description.slice(room.length) : l.description;
  return `${title}\n${body.charAt(0).toUpperCase()}${body.slice(1)}`;
}

function salesLine(l: EstimateLine, itemIds: Record<ItemKey, string>, taxable: ItemKey[]): QboLine {
  return {
    DetailType: "SalesItemLineDetail",
    Description: clip(lineText(l), 4000),
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
  | "deleted"
  | "unavailable"
  | "paid";

export const ESTIMATE_STATUS_LABEL: Record<EstimateStatusName, string> = {
  not_created: "Not created",
  created_unsent: "In QuickBooks, not sent",
  sent: "Sent, awaiting response",
  accepted: "Accepted",
  declined: "Declined",
  closed: "Closed",
  converted: "Invoiced",
  paid: "Completed, paid in full",
  deleted: "Deleted in QuickBooks",
  unavailable: "Status unavailable",
};

type RawEstimate = {
  TxnStatus?: string;
  TotalAmt?: number;
  EmailStatus?: string;
  AcceptedBy?: string;
  AcceptedDate?: string;
  LinkedTxn?: { TxnId: string; TxnType: string }[];
};

/** Invoices QuickBooks has linked to the estimate, as mirrored: how much was invoiced and how much is still owed. */
export type InvoiceSummary = { count: number; total: number; balance: number };

/**
 * The estimate's state as QuickBooks holds it. Once it has been invoiced, the
 * job counts as completed and paid when the invoices cover the whole estimate
 * and nothing is owed. (QuickBooks does not share a project's own "completed"
 * flag through this connection, so full payment is the signal.)
 */
export function estimateStatus(raw: RawEstimate | null | undefined, exists: boolean, invoices?: InvoiceSummary | null): EstimateStatusName {
  if (!exists) return "not_created";
  if (!raw || !raw.TxnStatus) return "unavailable";
  if (raw.LinkedTxn?.some((t) => t.TxnType === "Invoice")) {
    const estimateTotal = Number(raw.TotalAmt ?? 0);
    if (invoices && invoices.count > 0 && invoices.balance <= 0.005 && invoices.total >= estimateTotal - 0.01) return "paid";
    return "converted";
  }
  switch (raw.TxnStatus) {
    case "Accepted":
      return "accepted";
    case "Rejected":
      return "declined";
    case "Closed":
      return "closed";
    case "Deleted":
      return "deleted";
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
  // Match lines by description and by order within the same description, so
  // two lines with identical text are compared one to one.
  const keyed = (lines: ComparableLine[]) => {
    const seen = new Map<string, number>();
    return new Map(
      lines.map((l) => {
        const d = l.d.toLowerCase();
        const i = seen.get(d) ?? 0;
        seen.set(d, i + 1);
        return [`${d}#${i}`, l] as const;
      }),
    );
  };
  const inA = keyed(a);
  const inB = keyed(b);
  for (const [k, l] of inA) {
    const m = inB.get(k);
    if (!m) details.push(`Removed or renamed in QuickBooks: "${l.d}" (${money(l.a)})`);
    else if (m.q !== l.q || m.p !== l.p || m.a !== l.a) {
      details.push(`Changed in QuickBooks: "${l.d}" from ${l.q} x ${money(l.p)} = ${money(l.a)} to ${m.q} x ${money(m.p)} = ${money(m.a)}`);
    }
  }
  for (const [k, l] of inB) if (!inA.has(k)) details.push(`Added in QuickBooks: "${l.d}" (${money(l.a)})`);
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

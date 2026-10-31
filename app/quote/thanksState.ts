/**
 * What the quote form hands to /quote/thanks after a successful send.
 *
 * Session storage only, and never a contact detail: the confirmation page
 * repeats what was received (project, team, whether files attached) so the
 * visitor can check it, nothing that identifies them.
 */

export const QUOTE_ACCEPTED_KEY = "p5.quote-accepted";
export const QUOTE_RECEIPT_KEY = "p5.quote-receipt";

export type QuoteReceipt = {
  project: string;
  team: string;
  files: number;
  filesAttached: boolean;
};

export function saveQuoteReceipt(receipt: QuoteReceipt): void {
  try {
    sessionStorage.setItem(QUOTE_ACCEPTED_KEY, "1");
    sessionStorage.setItem(QUOTE_RECEIPT_KEY, JSON.stringify(receipt));
  } catch {
    // Private mode: the thanks page still confirms the request in general terms.
  }
}

export function parseQuoteReceipt(raw: string | null): QuoteReceipt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<QuoteReceipt>;
    if (typeof value.project !== "string" || typeof value.team !== "string") return null;
    return {
      project: value.project.slice(0, 120),
      team: value.team.slice(0, 120),
      files: typeof value.files === "number" && value.files > 0 ? Math.floor(value.files) : 0,
      filesAttached: value.filesAttached === true,
    };
  } catch {
    return null;
  }
}

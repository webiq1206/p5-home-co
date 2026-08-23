/**
 * Ask P5: plain-English questions answered from the P5 documentation only.
 *
 * Two tiers, both grounded:
 *   1. A curated answer bank for the questions people actually ask, written
 *      against the real P5 configuration. Highest confidence.
 *   2. Retrieval from the article index - the answer is the matching page's
 *      own words, quoted with a link.
 *
 * There is no generative step, which is precisely how the "never invent an
 * answer" requirement is met: every sentence shown either was written in the
 * answer bank or exists verbatim in an article. When neither tier clears its
 * confidence bar, Ask P5 says it does not know and shows where to look.
 */

import { ALL_ARTICLES } from "./index.ts";
import {
  blockText,
  buildIndex,
  expandQuery,
  search,
  tokenize,
  type SearchResult,
} from "./search.ts";

export type AskAnswer =
  | {
      kind: "answer";
      /** Short plain-language answer paragraphs. */
      paragraphs: string[];
      /** Numbered steps when the question is a how-to. */
      steps?: string[];
      /** What the system does on its own around this task. */
      automatic?: string;
      /** What the person must do. */
      action?: string;
      links: { label: string; href: string }[];
      /** Related pages from retrieval, for further reading. */
      related: SearchResult[];
    }
  | {
      kind: "page";
      intro: string;
      results: SearchResult[];
    }
  | {
      kind: "unknown";
      message: string;
      suggestions: SearchResult[];
    };

type BankEntry = {
  /** Phrasings that should land here; matching is token-based, not exact. */
  patterns: string[];
  paragraphs: string[];
  steps?: string[];
  automatic?: string;
  action?: string;
  links: { label: string; href: string }[];
};

const kb = (slug: string) => `/admin/kb/${slug}`;

export const ANSWER_BANK: BankEntry[] = [
  {
    patterns: [
      "how do i enter a subcontractor bill",
      "enter a vendor bill",
      "add a bill",
      "record a sub invoice",
      "how do bills get into quickbooks",
    ],
    paragraphs: [
      "Bills should be emailed to ap@p5homeco.com - QuickBooks reads the attachment and drafts the bill for you. Then you finish the coding:",
    ],
    steps: [
      "Open the drafted bill in QuickBooks and check every pre-filled field against the document.",
      "Confirm the vendor (watch for near-duplicates).",
      "Pick the project, the phase, and the item (usually Subcontractor Work for a sub).",
      "Link the purchase order if one exists, then save.",
    ],
    automatic:
      "Approval routes by amount (up to $2,500 project manager, $10,000 adds the manager, $50,000 adds an administrator), the compliance gate checks the vendor's W-9 and insurance, and the bill joins the weekly payment schedule.",
    action: "You do the coding and the approval - the system never guesses which project a cost belongs to.",
    links: [
      { label: "Enter a subcontractor bill (steps)", href: kb("enter-a-subcontractor-bill") },
      { label: "Accounts payable, end to end", href: kb("accounts-payable") },
    ],
  },
  {
    patterns: [
      "who needs to approve this bill",
      "who approves bills",
      "bill approval limits",
      "approval tiers",
    ],
    paragraphs: [
      "Approval depends on the amount: up to $2,500 the project manager; up to $10,000 the project manager plus the manager; up to $50,000 the manager plus an administrator; above $50,000 an administrator. These tiers are settings (Finance > Settings), not fixed rules - if they are ever misconfigured, the system requires the highest approval rather than none.",
    ],
    links: [
      { label: "Accounts payable, end to end", href: kb("accounts-payable") },
      { label: "Every automation we run", href: kb("automation-registry") },
    ],
  },
  {
    patterns: [
      "what happens when a lead becomes a customer",
      "lead becomes a customer",
      "deal is won what next",
      "after closed won",
      "won a deal",
    ],
    paragraphs: [
      "When a deal is marked Closed Won, HubSpot stamps the close date automatically - everything after that is deliberate human work: create the customer and project in QuickBooks, register the project in Finance > Projects with its brand and budget, collect the deposit (it books to Customer Deposits, account 2100), and the project then appears in the daily financial report with its own card.",
    ],
    links: [
      { label: "Create a project (steps)", href: kb("create-a-project") },
      { label: "The lead lifecycle, end to end", href: kb("lead-flow") },
    ],
  },
  {
    patterns: [
      "how do i see how much money is left on a project",
      "remaining project budget",
      "money left on a project",
      "how much budget is left",
      "budget remaining",
    ],
    paragraphs: [
      "Remaining budget = current budget - actual costs - open commitments (purchase orders not yet billed). You can see it three places: the project's card in the daily email report, Finance > Projects in the panel, and the project dashboard in QuickBooks (estimated vs actual).",
    ],
    automatic:
      "The panel recalculates this daily from synced QuickBooks data, and flags the project when the budget is nearly used or exceeded.",
    links: [
      { label: "How project health is scored", href: kb("project-financial-health") },
      { label: "Projects and jobs", href: kb("projects-and-jobs") },
    ],
  },
  {
    patterns: [
      "why is this deal still in this stage",
      "deal not moving",
      "deal stuck",
      "stuck in stage",
    ],
    paragraphs: [
      "Because a person left it there - nothing moves deals automatically in our setup. Check the deal's next action and next action date; every open deal must have both. If it has had no activity for 3 days it is flagged stale on the board. The fix is always one of three: do the next action, snooze it with a reason and a date, or close it honestly with a reason.",
    ],
    links: [
      { label: "The sales pipeline, stage by stage", href: kb("sales-pipeline") },
      { label: "Handle a new lead", href: kb("handle-a-new-lead") },
    ],
  },
  {
    patterns: [
      "how does a remodel project get entered into quickbooks",
      "enter a remodel in quickbooks",
      "set up a remodel project",
      "remodel project quickbooks",
    ],
    paragraphs: [
      "A remodel is a project under its customer with the class Boise Remodeling Co, phases from the Build (03-*) taxonomy (Site Work, Framing, Drywall, and so on), and the standard 13 items for costs. Note: cabinetry inside a remodel stays in the remodel project (phase 03-17) - Boise Cabinet Co and the CAB phases are only for standalone cabinet jobs.",
    ],
    steps: [
      "Find or create the customer, then create the project named P5-YYYY-#### plus a short address.",
      "Add the phases the job needs, set the 45% margin goal.",
      "Build the estimate line by line (phase + item + cost + price).",
      "Register the project in Finance > Projects with brand Boise Remodeling Co and its budget.",
    ],
    links: [
      { label: "Create a project (steps)", href: kb("create-a-project") },
      { label: "Cost codes, phases, and cost groups", href: kb("cost-codes-and-cost-groups") },
    ],
  },
  {
    patterns: [
      "what happens after an estimate is accepted",
      "estimate accepted",
      "customer accepted the estimate",
    ],
    paragraphs: [
      "Move the deal to Closed Won, then: collect the deposit (books to Customer Deposits 2100 until earned), create/activate the project, and invoice progress from the accepted estimate as work proceeds. The accepted estimate is both the budget and the basis for every invoice.",
    ],
    links: [
      { label: "Accounts receivable", href: kb("accounts-receivable") },
      { label: "Invoice a customer (steps)", href: kb("invoice-a-customer") },
    ],
  },
  {
    patterns: [
      "where do i see outstanding customer invoices",
      "outstanding invoices",
      "unpaid invoices",
      "open invoices",
      "who owes us money",
    ],
    paragraphs: [
      "Three places, by depth: the daily report's company snapshot shows totals (with overdue called out) and each project card shows that project's open invoices; Finance > Attention lists seriously overdue ones as items to act on; and QuickBooks' A/R Aging report has the complete detail.",
    ],
    links: [
      { label: "Accounts receivable", href: kb("accounts-receivable") },
      { label: "The daily financial report", href: kb("daily-financial-report") },
    ],
  },
  {
    patterns: [
      "when do vendors get paid",
      "when do we pay subs",
      "payment day",
      "pay vendors",
    ],
    paragraphs: [
      "Weekly, through the Money Run: it assembles Wednesday (preliminary - so problems surface early) and Friday (final - review, approve, and pay from Operating Checking 1010). Bills from vendors on compliance hold are excluded until the hold clears.",
    ],
    links: [
      { label: "Pay vendors (steps)", href: kb("pay-vendors") },
      { label: "The weekly Money Run", href: kb("money-run") },
    ],
  },
  {
    patterns: [
      "why is a payment on hold",
      "vendor on hold",
      "payment hold",
      "cannot pay vendor",
    ],
    paragraphs: [
      "A payment hold always has a recorded reason - most commonly a missing W-9, an expired insurance certificate, or a conditional lien waiver not yet accepted. Get the document; the hold releases automatically when it is verified. Never pay around a hold.",
    ],
    links: [
      { label: "Vendors and subcontractors", href: kb("vendors-and-subcontractors") },
    ],
  },
  {
    patterns: [
      "what is safe cash",
      "why is safe cash provisional",
      "how much can we spend",
    ],
    paragraphs: [
      "Safe Cash is what is genuinely spendable: operating cash, plus only high-confidence inflows (invoices due within 7 days), minus required payments, the tax reserve, the operating reserve, and other protected money. It is labeled provisional until the owner confirms the operating reserve and the CPA confirms the tax rate.",
    ],
    links: [
      { label: "The weekly Money Run", href: kb("money-run") },
    ],
  },
  {
    patterns: [
      "record a change order",
      "customer wants extra work",
      "add a change order",
    ],
    paragraphs: [
      "Price it, get written approval, then record it in BOTH systems: in QuickBooks with the Change Order item (revenue account 4050) on the project, and in Finance > Projects so the revised contract and budget move together.",
    ],
    links: [
      { label: "Record a change order (steps)", href: kb("record-a-change-order") },
    ],
  },
  {
    patterns: [
      "daily report did not arrive",
      "no report email",
      "report missing",
    ],
    paragraphs: [
      "Check in order: Finance > Daily Report (was it generated?), Finance > Settings (enabled, right recipients?), Finance > Health (did the job run, is SMTP configured?), then spam. The report is always viewable in the panel even when email fails.",
    ],
    links: [
      { label: "When something looks wrong", href: kb("troubleshooting-guide") },
      { label: "The daily financial report", href: kb("daily-financial-report") },
    ],
  },
];

// ---------------------------------------------------------------------------
// Matching. Confidence comes from token overlap between the question and a
// bank entry's patterns; below the bar we fall back to retrieval; below the
// retrieval bar we admit ignorance.
// ---------------------------------------------------------------------------

const INDEX = buildIndex(ALL_ARTICLES);

/** Every word the documentation actually uses. See the unknown-word gate. */
const VOCABULARY: Set<string> = new Set(
  ALL_ARTICLES.flatMap((a) => [
    ...tokenize(a.title),
    ...tokenize(a.summary),
    ...(a.keywords ?? []).flatMap(tokenize),
    ...a.blocks.flatMap((b) => tokenize(blockText(b))),
  ]),
);

function scoreAgainstBank(question: string, entry: BankEntry): number {
  const { direct, expanded } = expandQuery(question);
  const qTokens = new Set([...direct, ...expanded]);
  if (direct.length === 0) return 0;

  let best = 0;
  for (const pattern of entry.patterns) {
    const pTokens = tokenize(pattern).filter((t) => !STOP.has(t));
    if (pTokens.length === 0) continue;
    let hit = 0;
    for (const t of pTokens) if (qTokens.has(t)) hit += 1;
    const qContent = direct.filter((t) => !STOP.has(t));
    const qHit = qContent.filter((t) => pTokens.includes(t)).length;
    // Both directions matter: most of the pattern's words appear in the
    // question, and most of the question's content words appear in the
    // pattern - otherwise "bill" alone would match everything about bills.
    const patternCoverage = hit / pTokens.length;
    const questionCoverage = qContent.length ? qHit / qContent.length : 0;
    best = Math.max(best, patternCoverage * 0.6 + questionCoverage * 0.4);
  }
  return best;
}

/**
 * Ordinary English that carries no P5 meaning. Filtered out of both the
 * matcher and the unknown-word gate: "how often does..." must not be read
 * as asking about undocumented subjects called "often" and "does".
 */
const STOP = new Set(
  [
    "how", "do", "does", "did", "done", "i", "a", "an", "the", "is", "are", "was", "were", "be",
    "this", "that", "these", "those", "it", "its", "what", "when", "where", "why", "who", "whom",
    "which", "we", "us", "my", "our", "your", "you", "they", "them", "to", "in", "into", "on",
    "of", "for", "from", "with", "at", "by", "about", "as", "if", "or", "and", "but", "not",
    "get", "got", "make", "need", "want", "know", "tell", "show", "use", "used", "using",
    "can", "could", "should", "would", "will", "shall", "may", "might", "must",
    "often", "much", "many", "long", "soon", "again", "ever", "just", "only", "also", "then",
    "there", "here", "now", "still", "any", "some", "all", "each", "every", "one", "two",
    "please", "help", "thanks", "ok", "okay",
  ].map((w) => tokenize(w)[0] ?? w),
);

export function ask(question: string): AskAnswer {
  const trimmed = question.trim();
  if (!trimmed) {
    return {
      kind: "unknown",
      message: "Type a question - for example: How do I enter a subcontractor bill?",
      suggestions: [],
    };
  }

  // Tier 1: the curated bank.
  let bestEntry: BankEntry | null = null;
  let bestScore = 0;
  for (const entry of ANSWER_BANK) {
    const s = scoreAgainstBank(trimmed, entry);
    if (s > bestScore) {
      bestScore = s;
      bestEntry = entry;
    }
  }

  // Retrieval sees only the content words: "what is the ..." must not earn
  // coverage credit from filler that appears on every page.
  const contentTokens = tokenize(trimmed).filter((t) => !STOP.has(t));
  const related = contentTokens.length ? search(contentTokens.join(" "), INDEX, 4) : [];

  if (bestEntry && bestScore >= 0.55) {
    const entry = bestEntry;
    return {
      kind: "answer",
      paragraphs: entry.paragraphs,
      steps: entry.steps,
      automatic: entry.automatic,
      action: entry.action,
      links: entry.links,
      related: related
        .filter((r) => !entry.links.some((l) => l.href.endsWith(r.article.slug)))
        .slice(0, 2),
    };
  }

  // A word the corpus has never seen means the question is about something
  // P5 does not document at all ("wifi", "gate code"). Matching the rest of
  // the sentence would point at pages that cannot possibly answer it, so
  // this refuses outright rather than looking helpful.
  const unknownWords = contentTokens.filter((t) => !VOCABULARY.has(t));
  if (unknownWords.length > 0) {
    return {
      kind: "unknown",
      message:
        `The P5 documentation says nothing about ${unknownWords.join(", ")}, so I cannot answer that ` +
        "and I will not guess. If this should be documented, tell an administrator so the Knowledge Center gets a page for it.",
      suggestions: [],
    };
  }

  // Tier 2: retrieval. Note the wording - it claims only that these pages
  // MENTION what was asked, never that they answer it. Only the curated bank
  // above asserts an actual answer, which is what keeps Ask P5 honest when
  // lexical matching lands near a topic without landing on it.
  // A short question that matches completely ("what is backlog?") is as good
  // a hit as a long one that scores highly, so full coverage clears the bar
  // on its own - otherwise every one-word glossary lookup gets refused.
  const best = related[0];
  if (best && best.coverage >= 0.5 && (best.score >= 4 || best.coverage >= 0.99)) {
    return {
      kind: "page",
      intro:
        "I do not have a prepared answer for that exact question, but these Knowledge Center pages cover what you asked about - closest first:",
      results: related.slice(0, 3),
    };
  }

  // Tier 3: honesty.
  return {
    kind: "unknown",
    message:
      "I cannot answer that confidently from the current P5 documentation, and I will not guess. If this should be documented, tell an administrator so the Knowledge Center gets a page for it.",
    suggestions: related.slice(0, 3),
  };
}

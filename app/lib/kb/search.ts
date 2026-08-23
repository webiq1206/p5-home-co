/**
 * Knowledge Center search. Pure functions, no database, no network - the
 * index is built from the same article blocks the pages render, so search
 * can never disagree with the content.
 *
 * Design goals, in order: (1) the right page for plain-language phrases
 * ("pay subcontractor", "remaining project budget") even when the words do
 * not literally appear; (2) zero false confidence - weak matches rank low
 * and very weak ones are dropped; (3) fast enough to run per keystroke-free
 * GET request without caching games.
 */

import type { Article, Block } from "./types.ts";

// ---------------------------------------------------------------------------
// Tokenization. Lowercase, alphanumeric, with a light suffix-strip so that
// "invoices"/"invoicing" and "invoice" meet in the middle. Deliberately not
// a real stemmer: predictable beats clever in a small corpus.
// ---------------------------------------------------------------------------

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? []).map(stem);
}

function stem(word: string): string {
  if (word.length <= 3) return word;
  let base = word;
  for (const suffix of ["ings", "ing", "ies", "es", "ers", "er", "s", "ed"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      base = word.slice(0, -suffix.length);
      if (suffix === "ies") base += "y";
      break;
    }
  }
  // Drop a trailing silent e so invoice/invoices/invoicing share one stem.
  if (base.length > 3 && base.endsWith("e")) base = base.slice(0, -1);
  return base;
}

// ---------------------------------------------------------------------------
// Synonyms: the plain phrase a person types -> the vocabulary the docs use.
// Applied to the QUERY only (expanding documents would blur every page).
// Keys and values are stemmed at build time so entries stay readable here.
// ---------------------------------------------------------------------------

const SYNONYM_SOURCE: Record<string, string[]> = {
  pay: ["payment", "bill", "money run"],
  paid: ["payment"],
  sub: ["subcontractor"],
  subs: ["subcontractor"],
  vendor: ["subcontractor", "supplier"],
  supplier: ["vendor"],
  money: ["cash", "payment"],
  owe: ["payable", "bill"],
  owed: ["receivable", "invoice"],
  customer: ["client"],
  client: ["customer"],
  lead: ["deal"],
  deal: ["lead", "pipeline"],
  stage: ["pipeline"],
  budget: ["remaining", "cost"],
  leftover: ["remaining"],
  left: ["remaining"],
  bill: ["accounts payable", "vendor"],
  invoice: ["accounts receivable", "customer"],
  quickbooks: ["qbo"],
  qbo: ["quickbooks"],
  hubspot: ["crm"],
  crm: ["hubspot"],
  report: ["daily report", "snapshot"],
  email: ["report", "gmail"],
  brand: ["class", "division", "company"],
  company: ["brand", "class"],
  division: ["brand", "class"],
  phase: ["cost code"],
  code: ["cost code", "phase"],
  approve: ["approval"],
  boss: ["administrator", "manager"],
  overdue: ["late", "aging"],
  late: ["overdue"],
  broken: ["troubleshooting", "wrong"],
  error: ["troubleshooting"],
  wrong: ["troubleshooting"],
  deposit: ["customer deposit", "2100"],
  co: ["change order"],
  margin: ["profit", "gross profit"],
  profit: ["margin"],
  hold: ["payment hold", "compliance"],
  w9: ["w-9"],
  insurance: ["compliance", "certificate"],
  meeting: ["appointment", "scheduling"],
  appointment: ["meeting", "scheduled"],
  automatic: ["automation"],
  robot: ["automation"],
  glossary: ["definition", "term"],
  mean: ["glossary", "definition"],
};

const SYNONYMS: Map<string, string[]> = new Map(
  Object.entries(SYNONYM_SOURCE).map(([key, phrases]) => [
    stem(key.toLowerCase()),
    phrases.flatMap((p) => tokenize(p)),
  ]),
);

/** Query tokens plus their synonym expansions (expansions carry less weight). */
export function expandQuery(query: string): { direct: string[]; expanded: string[] } {
  const direct = tokenize(query);
  const expanded: string[] = [];
  for (const token of direct) {
    for (const syn of SYNONYMS.get(token) ?? []) {
      if (!direct.includes(syn) && !expanded.includes(syn)) expanded.push(syn);
    }
  }
  return { direct, expanded };
}

// ---------------------------------------------------------------------------
// Index. Field-weighted bags of tokens per article, plus per-block text so a
// result can show the sentence that matched, not just a title.
// ---------------------------------------------------------------------------

export function blockText(block: Block): string {
  switch (block.t) {
    case "p":
    case "h":
      return block.text;
    case "steps":
      return [block.title ?? "", ...block.items].join(" ");
    case "list":
      return block.items.join(" ");
    case "callout":
      return [block.title ?? "", block.text].join(" ");
    case "table":
      return [block.headers.join(" "), ...block.rows.map((r) => r.join(" "))].join(" ");
    case "flow":
      return [block.title ?? "", ...block.steps.map((s) => `${s.label} ${s.detail ?? ""}`)].join(" ");
    case "faq":
      return block.items.map((i) => `${i.q} ${i.a}`).join(" ");
    case "terms":
      return block.items.map((i) => `${i.term} ${i.def}`).join(" ");
    case "links":
      return [block.title ?? "", ...block.items.map((i) => i.label)].join(" ");
  }
}

type IndexedArticle = {
  article: Article;
  /** token -> accumulated field weight */
  weights: Map<string, number>;
  /** plain text per block, for snippets */
  blockTexts: string[];
};

const FIELD_WEIGHTS = { title: 6, keywords: 5, summary: 3, heading: 3, body: 1 };

/**
 * How many times one word in the body may count toward a score.
 *
 * Without a ceiling, length wins. A long reference article that happens to say
 * "vendor" forty times outranks the short article that is actually ABOUT
 * vendors, purely by repetition - and the longest article in the section
 * quietly becomes the answer to everything.
 *
 * Title, summary, headings and keywords are deliberately not capped: those are
 * short and hand-chosen, so repetition there is a real signal.
 */
const BODY_TOKEN_CAP = 4;

function addTokens(weights: Map<string, number>, text: string, weight: number): void {
  for (const token of tokenize(text)) {
    weights.set(token, (weights.get(token) ?? 0) + weight);
  }
}

/** Body tokens, counted per article and capped before they are weighted. */
function addBodyTokens(weights: Map<string, number>, texts: string[]): void {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const token of tokenize(text)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  for (const [token, count] of counts) {
    const capped = Math.min(count, BODY_TOKEN_CAP) * FIELD_WEIGHTS.body;
    weights.set(token, (weights.get(token) ?? 0) + capped);
  }
}

export function buildIndex(articles: Article[]): IndexedArticle[] {
  return articles.map((article) => {
    const weights = new Map<string, number>();
    addTokens(weights, article.title, FIELD_WEIGHTS.title);
    addTokens(weights, article.summary, FIELD_WEIGHTS.summary);
    for (const kw of article.keywords ?? []) addTokens(weights, kw, FIELD_WEIGHTS.keywords);
    const blockTexts: string[] = [];
    const bodyTexts: string[] = [];
    for (const block of article.blocks) {
      const text = blockText(block);
      blockTexts.push(text);
      // Headings stay uncapped - an author writing a heading is naming the
      // subject, not repeating a word in passing.
      if (block.t === "h") addTokens(weights, text, FIELD_WEIGHTS.heading);
      else bodyTexts.push(text);
    }
    addBodyTokens(weights, bodyTexts);
    return { article, weights, blockTexts };
  });
}

// ---------------------------------------------------------------------------
// Scoring and search.
// ---------------------------------------------------------------------------

export type SearchResult = {
  article: Article;
  score: number;
  /** Fraction of the user's own words this article matched (0..1). */
  coverage: number;
  /** The best-matching sentence, for display under the title. */
  snippet: string;
};

export function search(
  query: string,
  index: IndexedArticle[],
  limit = 8,
): SearchResult[] {
  const { direct, expanded } = expandQuery(query);
  if (direct.length === 0) return [];

  const results: SearchResult[] = [];
  for (const entry of index) {
    let score = 0;
    let hit = 0;
    for (const token of direct) {
      const w = entry.weights.get(token) ?? 0;
      if (w > 0) {
        hit += 1;
        score += w;
      }
    }
    // Synonym hits count half: they find the page, they do not fake coverage.
    for (const token of expanded) {
      score += (entry.weights.get(token) ?? 0) * 0.5;
    }
    if (score <= 0) continue;

    const coverage = hit / direct.length;
    // Multi-word queries must match more than a stray word somewhere.
    if (direct.length >= 2 && coverage === 0 && score < 3) continue;

    results.push({
      article: entry.article,
      score: score * (0.5 + coverage),
      coverage,
      snippet: bestSnippet(entry, [...direct, ...expanded]),
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function bestSnippet(entry: IndexedArticle, tokens: string[]): string {
  let best = entry.article.summary;
  let bestScore = 0;
  for (const text of entry.blockTexts) {
    // Split to sentence-ish chunks so the snippet stays readable.
    for (const sentence of text.split(/(?<=[.?!])\s+/)) {
      if (sentence.length < 15) continue;
      const stems = tokenize(sentence);
      let s = 0;
      for (const token of tokens) if (stems.includes(token)) s += 1;
      if (s > bestScore) {
        bestScore = s;
        best = sentence.trim();
      }
    }
  }
  return best.length > 220 ? best.slice(0, 217) + "..." : best;
}

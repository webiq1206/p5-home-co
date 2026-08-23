/**
 * Knowledge Center runtime state: per-article verification flags.
 *
 * Articles carry their authored lastVerified date in code; this table only
 * overrides it when the drift check has news - a later automated
 * verification, or a flag. Every read here tolerates a missing database:
 * documentation must stay readable even when nothing else works.
 */

import { query } from "../db.ts";

export type ArticleState = {
  slug: string;
  lastVerifiedOn: string | null;
  flagged: boolean;
  flagReason: string | null;
};

export async function loadArticleStates(): Promise<Map<string, ArticleState>> {
  try {
    const rows = await query<{
      slug: string;
      last_verified_on: string | null;
      flagged: boolean;
      flag_reason: string | null;
    }>(
      `SELECT slug, last_verified_on::text, flagged, flag_reason FROM kb_article_state`,
    );
    return new Map(
      rows.map((r) => [
        r.slug,
        {
          slug: r.slug,
          lastVerifiedOn: r.last_verified_on,
          flagged: r.flagged,
          flagReason: r.flag_reason,
        },
      ]),
    );
  } catch {
    // No database (or table): fall back to the authored dates, unflagged.
    return new Map();
  }
}

export async function flagArticle(slug: string, reason: string): Promise<void> {
  await query(
    `INSERT INTO kb_article_state (slug, flagged, flag_reason, flagged_at, updated_at)
     VALUES ($1, TRUE, $2, now(), now())
     ON CONFLICT (slug) DO UPDATE SET
       flagged = TRUE, flag_reason = $2,
       flagged_at = COALESCE(kb_article_state.flagged_at, now()),
       updated_at = now()`,
    [slug, reason],
  );
}

export async function markArticleVerified(slug: string, onDate: string): Promise<void> {
  await query(
    `INSERT INTO kb_article_state (slug, last_verified_on, flagged, flag_reason, flagged_at, updated_at)
     VALUES ($1, $2, FALSE, NULL, NULL, now())
     ON CONFLICT (slug) DO UPDATE SET
       last_verified_on = $2, flagged = FALSE, flag_reason = NULL,
       flagged_at = NULL, updated_at = now()`,
    [slug, onDate],
  );
}

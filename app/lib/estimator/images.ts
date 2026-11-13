/**
 * Which option images exist. Server only (reads the public folder), so a card
 * whose image has not been produced yet renders as a text card instead of a
 * broken picture.
 */

import { readdirSync } from "node:fs";
import path from "node:path";

let cached: string[] | null = null;

export function estimatorImages(): string[] {
  if (cached) return cached;
  try {
    cached = readdirSync(path.join(process.cwd(), "public", "estimator", "img"))
      .filter((name) => name.endsWith(".webp"))
      .map((name) => name.replace(/\.webp$/, ""));
  } catch {
    cached = [];
  }
  return cached;
}

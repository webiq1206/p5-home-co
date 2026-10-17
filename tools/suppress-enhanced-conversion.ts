/**
 * Add an enhanced-conversion suppression. The value is hashed before insert.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env.local tools/suppress-enhanced-conversion.ts --email ada@example.com
 *   node --experimental-strip-types --env-file-if-exists=.env.local tools/suppress-enhanced-conversion.ts --phone 2084771169
 *
 * Prints the stored hash only. A phone that is not 10 digits is not stored.
 */

import { insertSuppression } from "../lib/p5/enhancedConversionSuppression.ts";

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

const email = argument("--email");
const phone = argument("--phone");
if (email === undefined && phone === undefined) {
  console.error("Pass --email, --phone, or both. Nothing was stored.");
  process.exit(1);
}

const stored = await insertSuppression({ email, phone });
if (!stored.length) {
  console.error("Nothing stored. Email must contain text, and a phone must be exactly 10 digits.");
  process.exit(1);
}
for (const record of stored) console.log(`Stored ${record.kind} hash ${record.valueHash}`);

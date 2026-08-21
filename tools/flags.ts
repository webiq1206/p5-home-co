/**
 * Read and change integration feature flags.
 *
 *   npm run flags                      # show current state
 *   npm run flags -- --enable hubspot
 *   npm run flags -- --disable hubspot
 *
 * Flags live in the settings table, so this is a runtime decision that can be
 * reversed without a deploy. Reads DATABASE_URL from the environment.
 */

import { Client } from "pg";

const SETTINGS_KEY = "lead_manager";

/** Flags this tool may change, and what each one actually switches on. */
const MANAGEABLE: Record<string, string> = {
  hubspot: "hubspotIntegrationEnabled — sync contacts and deals to HubSpot",
  gmail: "gmailIntegrationEnabled — reserved; no Gmail code exists yet",
  facebook: "facebookIntegrationEnabled — reserved; no Facebook code exists yet",
};

/**
 * Deliberately not manageable here. The brief requires both to stay
 * disconnected, and neither has any implementation, so enabling the flag would
 * create a system that claims an integration it does not have.
 */
const DEFERRED: Record<string, string> = {
  handoff: "handoffIntegrationEnabled",
  quickbooks: "quickBooksIntegrationEnabled",
};

const FLAG_KEYS: Record<string, string> = {
  hubspot: "hubspotIntegrationEnabled",
  gmail: "gmailIntegrationEnabled",
  facebook: "facebookIntegrationEnabled",
};

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("sslmode=disable") ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const enable = arg("--enable");
    const disable = arg("--disable");
    const target = enable ?? disable;

    if (target) {
      if (DEFERRED[target]) {
        console.error(
          `Refusing to change "${target}".\n` +
            `${DEFERRED[target]} must stay false: there is no ${target} code, so ` +
            `enabling it would claim an integration that does not exist.`,
        );
        process.exit(1);
      }
      if (!FLAG_KEYS[target]) {
        console.error(`Unknown flag "${target}". Known: ${Object.keys(MANAGEABLE).join(", ")}`);
        process.exit(1);
      }

      const value = enable !== null;
      // Merge into the stored object so other settings survive untouched.
      await client.query(
        `INSERT INTO setting (key, value)
         VALUES ($1, jsonb_build_object('featureFlags', jsonb_build_object($2::text, $3::boolean)))
         ON CONFLICT (key) DO UPDATE SET
           value = jsonb_set(
             COALESCE(setting.value, '{}'::jsonb),
             ARRAY['featureFlags', $2::text],
             to_jsonb($3::boolean),
             true
           ),
           updated_at = now()`,
        [SETTINGS_KEY, FLAG_KEYS[target], value],
      );
      console.log(`${value ? "Enabled" : "Disabled"} ${FLAG_KEYS[target]}.`);

      if (target === "hubspot" && value) {
        const pending = await client.query<{ n: string }>(
          "SELECT count(*) AS n FROM deal WHERE integration_sync_status IN ('pending','failed')",
        );
        console.log(
          `\n${pending.rows[0].n} deal(s) are queued to sync. The watchdog picks them ` +
            `up on its next pass; nothing needs triggering by hand.`,
        );
        if (!process.env.HUBSPOT_TOKEN) {
          console.log(
            "\nNote: HUBSPOT_TOKEN is not set in this environment. The sync stays " +
              "a no-op until it is set where the app runs.",
          );
        }
      }
      console.log();
    }

    const stored = await client.query<{ value: { featureFlags?: Record<string, boolean> } }>(
      "SELECT value FROM setting WHERE key = $1",
      [SETTINGS_KEY],
    );
    const flags = stored.rows[0]?.value?.featureFlags ?? {};

    console.log("Current flags (unset means the code default, which is false):");
    for (const [name, description] of Object.entries(MANAGEABLE)) {
      const key = FLAG_KEYS[name];
      const state = flags[key] === true ? "ON " : "off";
      console.log(`  ${state}  ${description}`);
    }
    for (const [name, key] of Object.entries(DEFERRED)) {
      console.log(`  off  ${key} — deliberately deferred, not manageable here (${name})`);
    }
  } finally {
    await client.end();
  }
}

await main();

// Makes this file a module, which top-level await requires.
export {};

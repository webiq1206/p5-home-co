/** Pricing setup for the scope platform, plus the live QuickBooks setup check. */

import { redirect } from "next/navigation";

import { can, getScopeUser } from "../../lib/auth.ts";
import { COST_BOOK_REVIEWED_AT, COST_BOOK_SOURCE } from "../../lib/scopes/costbook.ts";
import { DIVISIONS } from "../../lib/scopes/divisions.ts";
import { loadScopeSettings } from "../../lib/scopes/store.ts";
import ScopesChrome from "../_components/ScopesChrome.tsx";
import SettingsClient from "../_components/SettingsClient.tsx";
import "../_components/scopes.css";

export const dynamic = "force-dynamic";

export default async function ScopeSettings() {
  const user = await getScopeUser();
  if (!user) redirect("/scopes/login");
  // Pricing setup holds internal cost and markup rules: employees only.
  if (user.scopesOnly) redirect("/scopes");
  const settings = await loadScopeSettings();
  return (
    <>
      <ScopesChrome user={user} />
      <main className="admin-main sc-main">
        <h1 className="admin-h1">Pricing setup</h1>
        <p className="admin-sub">
          Cost book: {COST_BOOK_SOURCE}, imported {COST_BOOK_REVIEWED_AT}. {DIVISIONS.length} divisions, 00 to 33 plus 90.
        </p>
        <SettingsClient initial={settings} canManage={can(user.role, "manage_settings")} divisions={DIVISIONS} />
      </main>
    </>
  );
}

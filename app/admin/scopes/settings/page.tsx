/** Pricing setup for the scope platform, plus the live QuickBooks setup check. */

import { redirect } from "next/navigation";

import { can, getSessionUser } from "../../../lib/auth.ts";
import { COST_BOOK_REVIEWED_AT, COST_BOOK_SOURCE } from "../../../lib/scopes/costbook.ts";
import { DIVISIONS } from "../../../lib/scopes/divisions.ts";
import { loadScopeSettings } from "../../../lib/scopes/store.ts";
import AdminChrome from "../../AdminChrome.tsx";
import SettingsClient from "../_components/SettingsClient.tsx";
import "../_components/scopes.css";

export const dynamic = "force-dynamic";

export default async function ScopeSettings() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  const settings = await loadScopeSettings();
  return (
    <>
      <AdminChrome user={user} active="scopes" subtitle="Scopes" />
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

import { redirect } from "next/navigation";
import AdminChrome from "../../AdminChrome.tsx";
import { getSessionUser } from "../../../lib/auth.ts";
import { metaAdminSnapshot } from "../../../lib/integrations/meta-admin.ts";
import MetaPanel from "./MetaPanel.tsx";

export const dynamic = "force-dynamic";

export default async function MetaIntakeAdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "administrator") redirect("/admin/lead-manager");

  let snapshot: Awaited<ReturnType<typeof metaAdminSnapshot>> | null = null;
  try {
    snapshot = await metaAdminSnapshot();
  } catch {
    // Keep infrastructure details out of the admin UI; the panel explains
    // that setup/readiness data could not be loaded.
  }

  return (
    <>
      <AdminChrome user={user} active="leads" subtitle="Meta intake" />
      <main className="admin-main">
        <h1 className="admin-h1">Meta intake readiness</h1>
        <p className="admin-sub">Multi-brand Page access, form routing, and receipt health for P5 Home Co.</p>
        <MetaPanel snapshot={snapshot} />
      </main>
    </>
  );
}

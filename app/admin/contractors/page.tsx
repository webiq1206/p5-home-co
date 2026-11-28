import { redirect } from "next/navigation";
import { getSessionUser } from "../../lib/auth";
import AdminChrome from "../AdminChrome";
import ContractorsDirectory from "./ContractorsDirectory";
import "./contractors.css";

export const dynamic = "force-dynamic";

export default async function ContractorsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  const canEdit = user.role === "administrator";
  return <>
    <AdminChrome user={user} active="contractors" />
    <main className="admin-main ct-main">
      <header className="ct-heading">
        <p className="ct-kicker">P5 Operations</p>
        <h1 className="admin-h1">Contractor Directory</h1>
        <p className="admin-sub">Find the right trade, check their work history, and reach them from one profile.</p>
      </header>
      <ContractorsDirectory canEdit={canEdit}/>
    </main>
  </>;
}

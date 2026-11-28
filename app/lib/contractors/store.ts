import { createHash } from "node:crypto";
import { getSessionUser, type SessionUser } from "../auth.ts";
import { query, transaction } from "../db.ts";
import { compareIdentity, contractorFields, ContractorStoreError, isRecord, type ContractorFields } from "./identity.ts";

import { planContractorImport } from "./import-plan.ts";

export { ContractorStoreError } from "./identity.ts";
export type { Capability } from "./identity.ts";
export type Contractor = ContractorFields & {
  id: number;
  qboVendorId: string | null;
  hubspotCompanyId: string | null;
  hubspotContactId: string | null;
  qualified: boolean;
};
type DbRow = {
  id: string; company: string; contact: string; phone: string; email: string; service_area: string;
  capabilities: ContractorFields["capabilities"]; history: string; pricing_notes: string;
  qbo_vendor_id: string | null; hubspot_company_id: string | null; hubspot_contact_id: string | null;
  compliance_status: string; payment_hold: boolean; qbo_active: boolean | null;
};

const directorySql = `
 SELECT v.id, COALESCE(d.company, v.display_name) AS company,
        COALESCE(NULLIF(d.contact,''), NULLIF(concat_ws(' ',q.raw->>'GivenName',q.raw->>'FamilyName'),''),'') AS contact,
        COALESCE(NULLIF(d.phone,''), q.raw#>>'{PrimaryPhone,FreeFormNumber}', '') AS phone,
        COALESCE(NULLIF(d.email,''), q.raw#>>'{PrimaryEmailAddr,Address}', '') AS email,
        COALESCE(d.service_area,'') AS service_area,
        COALESCE(d.capabilities,'[]'::jsonb) AS capabilities,
        COALESCE(d.history,'') AS history, COALESCE(d.pricing_notes,'') AS pricing_notes,
        v.qbo_vendor_id,d.hubspot_company_id,d.hubspot_contact_id,
        v.compliance_status,v.payment_hold,q.active AS qbo_active
   FROM vendor_profile v LEFT JOIN contractor_directory_profile d ON d.vendor_id=v.id
   LEFT JOIN qbo_vendor q ON q.qbo_id=v.qbo_vendor_id
  WHERE v.active
    AND (d.vendor_id IS NOT NULL OR v.vendor_type IN ('Trade Subcontractor','Material Supplier','Professional Service','Independent Contractor','Equipment Rental'))`;
const excludedIdentitySql = `
 SELECT v.id, COALESCE(d.company,v.display_name) AS company,
        COALESCE(NULLIF(d.phone,''),q.raw#>>'{PrimaryPhone,FreeFormNumber}','') AS phone,
        COALESCE(NULLIF(d.email,''),q.raw#>>'{PrimaryEmailAddr,Address}','') AS email
 FROM vendor_profile v LEFT JOIN contractor_directory_profile d ON d.vendor_id=v.id
 LEFT JOIN qbo_vendor q ON q.qbo_id=v.qbo_vendor_id
 WHERE NOT (v.active AND (d.vendor_id IS NOT NULL OR v.vendor_type IN
      ('Trade Subcontractor','Material Supplier','Professional Service','Independent Contractor','Equipment Rental')))`;
function project(r:DbRow): Contractor {
  return {
    id:Number(r.id),company:r.company,contact:r.contact,phone:r.phone,email:r.email,
    serviceArea:r.service_area,capabilities:r.capabilities,history:r.history,pricingNotes:r.pricing_notes,
    qboVendorId:r.qbo_vendor_id,hubspotCompanyId:r.hubspot_company_id,hubspotContactId:r.hubspot_contact_id,
    qualified: !r.payment_hold && r.qbo_active !== false && ["Compliant","Expiring Soon"].includes(r.compliance_status),
  };
}

export async function requireContractorActor({ write = false }: {write?:boolean} = {}): Promise<SessionUser> {
  const actor = await getSessionUser();
  if (!actor?.isActive) throw new ContractorStoreError("Sign in required.",401);
  if (write && actor.role !== "administrator") throw new ContractorStoreError("An administrator must make this change.",403);
  return actor;
}

export async function listContractors(): Promise<Contractor[]> {
  return (await query<DbRow>(directorySql + " ORDER BY lower(COALESCE(d.company,v.display_name)),v.id")).map(project);
}

/** Preview, or commit the exact reviewed plan. External records are never changed. */
export async function importContractorRoster(inputs:readonly unknown[],actorId:number,expectedToken?:string) {
  if (!Number.isSafeInteger(actorId) || actorId<1) throw new ContractorStoreError("Sign in required.",401);
  return transaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(72948931)");
    // The QBO mirror creates vendor_profile records too. Stabilize the local
    // identity inventory for the short commit, never for the preview.
    if (expectedToken!==undefined) await client.query("LOCK TABLE vendor_profile IN SHARE ROW EXCLUSIVE MODE");
    const directory=(await client.query<DbRow>(directorySql)).rows.map(project);
    const inactive=await client.query<{id:string;company:string;phone:string;email:string}>(excludedIdentitySql);
    const hold=new Set(inactive.rows.map(x=>Number(x.id)));
    const candidates:Contractor[]=[...directory,...inactive.rows.map(x=>({
      id:Number(x.id),company:x.company,phone:x.phone,email:x.email,contact:"",serviceArea:"",history:"",pricingNotes:"",capabilities:[],
      qualified:false,qboVendorId:null,hubspotCompanyId:null,hubspotContactId:null,
    }))];
    const plan=planContractorImport(candidates,inputs).map(item=>item.outcome==="existing_candidate" && hold.has(item.candidates[0]?.id) ? {...item,outcome:"needs_review" as const} : item);
    const token=createHash("sha256").update(JSON.stringify({actorId,plan})).digest("hex");
    if (expectedToken!==undefined && token!==expectedToken) throw new ContractorStoreError("The directory changed. Review a fresh import preview.",409);
    let saved=0, unchanged=0;
    if (expectedToken!==undefined) for(const entry of plan) {
      if (entry.outcome==="new_candidate") {
        const p=entry.proposed;
        const id=(await client.query<{id:string}>(
          "INSERT INTO vendor_profile(display_name) VALUES($1) RETURNING id",[p.company],
        )).rows[0]?.id;
        if (!id) throw new ContractorStoreError("Could not import contractor.",503);
        await client.query(
          `INSERT INTO contractor_directory_profile(vendor_id,company,contact,phone,email,service_area,capabilities,history,pricing_notes,updated_by)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
          [id,p.company,p.contact,p.phone,p.email,p.serviceArea,JSON.stringify(p.capabilities),p.history,p.pricingNotes,actorId]);
        saved++;
      } else if(entry.outcome==="existing_candidate") {
        // Existing records need explicit review before fields or capabilities are merged.
        unchanged++;
      }
    }
    return {
      token,committed:expectedToken!==undefined,saved,unchanged,
      rows:plan.map(x=>x.outcome==="invalid" ? x : ({
        index:x.index,outcome:x.outcome,company:x.proposed.company,candidates:x.candidates,repeatedRows:x.repeatedRows,
      })),
    };
  });
}
export async function saveContractor(input: unknown, actorId: number): Promise<Contractor> {
  if (!isRecord(input) || !isRecord(input.contractor)) throw new ContractorStoreError("Enter contractor details.",400);
  const id = input.id === undefined ? null : input.id;
  if (id !== null && (typeof id!=="number" || !Number.isSafeInteger(id) || id<1)) throw new ContractorStoreError("Invalid contractor.",400);
  if (!Number.isSafeInteger(actorId) || actorId<1) throw new ContractorStoreError("Sign in required.",401);
  const patch=input.contractor;
  return transaction(async client=>{
    // Keep the candidate inventory stable against both other edits and the QBO mirror.
    await client.query("SELECT pg_advisory_xact_lock(72948931)");
    await client.query("LOCK TABLE vendor_profile IN SHARE ROW EXCLUSIVE MODE");
    const directory=(await client.query<DbRow>(directorySql)).rows.map(project);
    const before=id===null ? undefined : directory.find(x=>x.id===id);
    if (id!==null && !before) throw new ContractorStoreError("Contractor not found.",404);
    for (const key of ["qboVendorId","hubspotCompanyId","hubspotContactId"] as const) {
      if (Object.hasOwn(patch,key) && (patch[key]||null)!==(before?.[key]??null)) {
        throw new ContractorStoreError("External links must be verified before they can be changed.",409);
      }
    }
    const next = contractorFields(patch,before);
    const changedIdentity=!before || before.company!==next.company || before.email!==next.email || before.phone!==next.phone;
    const outside=changedIdentity ? (await client.query<{id:string;company:string;phone:string;email:string}>(excludedIdentitySql)).rows : [];
    if (changedIdentity && [...directory,...outside].some(x=>Number(x.id)!==id && compareIdentity(next,x)!=="none")) {
      throw new ContractorStoreError("A possible matching contractor already exists. Review that profile before making this change.",409);
    }
    const vendorId=id ?? (await client.query<{id:string}>(
      "INSERT INTO vendor_profile(display_name) VALUES($1) RETURNING id",[next.company],
    )).rows[0]?.id;
    if (!vendorId) throw new ContractorStoreError("Could not save contractor.",503);
    await client.query(
      `INSERT INTO contractor_directory_profile(vendor_id,company,contact,phone,email,service_area,capabilities,history,pricing_notes,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
       ON CONFLICT(vendor_id) DO UPDATE SET company=EXCLUDED.company,contact=EXCLUDED.contact,phone=EXCLUDED.phone,
       email=EXCLUDED.email,service_area=EXCLUDED.service_area,capabilities=EXCLUDED.capabilities,history=EXCLUDED.history,
       pricing_notes=EXCLUDED.pricing_notes,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [vendorId,next.company,next.contact,next.phone,next.email,next.serviceArea,JSON.stringify(next.capabilities),next.history,next.pricingNotes,actorId]);
    const saved=(await client.query<DbRow>(directorySql + " AND v.id=$1",[vendorId])).rows[0];
    if (!saved) throw new ContractorStoreError("Could not read back contractor.",503);
    return project(saved);
  });
}

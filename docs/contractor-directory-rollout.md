# Contractor Directory and project outreach

Status: review candidate. Do not merge or publish until the deployment and data checks below pass.

- The existing P5 `vendor_profile` is the internal contractor identity. Its finance ownership and compliance controls stay in place. Curated details and scope-specific capabilities live alongside it.
- Contractor Directory retains one identity with multiple trade capabilities and division order. Only documented capability and verified geographic coverage qualify; missing coverage or compliance stays visible rather than guessed.
- The outreach board uses saved project scopes and append-only snapshots of outreach events. Customer-facing public and scopes-only sessions must not see the directory, notes or a project's contractor history.
- Staff may open a mail draft or place a call. The app sends no outreach and does not create remote parties.
- Import only from a private authenticated P5 session. Map the source's company/contact/phone/email/service area and division/trade columns into the import schema. Preview before commit. A normalized company name alone is not enough to combine records. Existing, conflicting, inactive and ambiguous records require review; unreviewed capabilities cannot qualify for recommendations. Never check real contact payloads into source control.
- The existing roster has 622 rows, including repeated company names. A first source pass found a phone or email on 328 rows and no explicitly populated service-area cells. These counts describe intake records, not approved unique contractors. Do not populate missing areas or capability confirmations from a generic label or an address.
- Add verified HubSpot company/contact associations in P5 portal 247066159 and reconcile vendor mirror matches by corroborated evidence before adding any remote records. Read/update sync, conflict handling and provider readbacks are separate open work; this candidate does not write QBO or HubSpot.
- Confirm exact P5 scope-to-QBO project links for the active-project inventory, including Nelson and Stillman. Use saved scopes, not customer or project name alone. Stillman's preliminary QBO scope is preconstruction only; do not treat it as authorization for construction.
- Before production: exact-head build and app/browser tests, isolated migration/read-write/auth checks, import preview/reconciliation, capability/service-area review, proven private UI routes, verified current-project scope coverage, and owner-controlled deployment. Email the requested links after authenticated production verification, not before.

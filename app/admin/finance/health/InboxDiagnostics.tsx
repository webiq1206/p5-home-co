"use client";

import { useActionState, useState } from "react";
import { checkInboxBinding, testOwnerEmailActivity, type InboxDiagnosticActionResult } from "./inbox-actions.ts";

export default function InboxDiagnostics() {
  const [binding, check, checking] = useActionState<InboxDiagnosticActionResult | null, FormData>(checkInboxBinding, null);
  const [write, test, testing] = useActionState<InboxDiagnosticActionResult | null, FormData>(testOwnerEmailActivity, null);
  const [confirmed, setConfirmed] = useState(false);
  return <section className="fin-section">
    <h2>Central inbox connection checks</h2>
    <p>These administrator checks run while ongoing inbox sync is off. They never enable sync or send email.</p>
    <form action={check}>
      <button className="lead-action" disabled={checking || testing}>{checking ? "Checking connection…" : "Check production inbox binding"}</button>
    </form>
    <p>The read-only check verifies hello@p5homeco.com, the P5 HubSpot account, and the approved October 8 owner delivery test from hello@webiq.co against its existing native email activity.</p>
    {binding && <pre role="status" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(binding, null, 2)}</pre>}
    <form action={test}>
      <label><input type="checkbox" name="confirmOwnerDiagnostic" value="yes" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        Create at most one clearly labeled connection-test activity, copied from that approved owner test and linked to the hello@webiq.co contact. HubSpot may also link that contact’s verified company. This is not a customer recovery.</label>
      <p><button className="lead-action" disabled={!binding?.ok || !confirmed || checking || testing}>{testing ? "Verifying test activity…" : "Create or verify owner test activity"}</button></p>
    </form>
    {write && <pre role="status" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(write, null, 2)}</pre>}
    <p>A permission failure or uncertain creation remains blocked for review. Repeating the check never authorizes a second test activity. Production checks must pass before the separate sync activation settings can be set.</p>
  </section>;
}

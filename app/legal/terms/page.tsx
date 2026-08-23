import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use | P5 Home Co",
  description:
    "The terms governing use of the P5 Home Co finance platform, vendor portal, and client portal.",
  alternates: { canonical: "/legal/terms" },
};

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Use</h1>
      <p className="legal-updated">Last updated 23 August 2026</p>

      <p className="legal-lead">
        These terms govern access to the P5 Home Co finance platform and the
        vendor and client portals operated at p5homeco.com. They are an
        agreement between you and P5 Home Co. LLC, an Idaho limited liability
        company (&ldquo;P5&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;).
      </p>

      <h2>1. What this software is</h2>
      <p>
        The platform is private business software that P5 operates for its own
        construction operations and for the people it works with. It is not a
        product sold, licensed, or offered to the general public, and there is
        no public sign-up. Access is granted by invitation only, in one of
        three roles:
      </p>
      <ul>
        <li>
          <strong>P5 staff</strong> use the finance platform to run project
          budgets, payables, compliance, and reporting.
        </li>
        <li>
          <strong>Vendors and subcontractors</strong> use the vendor portal to
          see their own compliance documents, lien waivers, and payment status.
        </li>
        <li>
          <strong>Clients</strong> use the client portal to see their own
          project status, contract value, and invoices.
        </li>
      </ul>

      <h2>2. Access and accounts</h2>
      <p>
        Staff accounts are issued by a P5 administrator. Vendor and client
        access uses a single-use sign-in link sent to an invited email address;
        links expire and cannot be reused. You are responsible for keeping your
        email account secure, for the activity that happens under your access,
        and for telling us promptly if you believe your access has been
        compromised. Do not share sign-in links.
      </p>

      <h2>3. What you may and may not do</h2>
      <p>You agree not to:</p>
      <ul>
        <li>
          attempt to access data belonging to any other vendor, client, or
          project;
        </li>
        <li>
          probe, scan, or test the security of the platform, or interfere with
          its normal operation;
        </li>
        <li>
          use the platform to store or transmit unlawful material, or to
          infringe anyone&rsquo;s rights;
        </li>
        <li>
          copy, resell, or redistribute the platform or the data it contains,
          except your own records.
        </li>
      </ul>
      <p>
        The portals are built so that each party sees only its own information.
        Attempting to circumvent that separation is a breach of these terms and
        may end your access immediately.
      </p>

      <h2>4. QuickBooks Online</h2>
      <p>
        The platform connects to P5&rsquo;s own QuickBooks Online company file.
        That connection is authorised by a P5 administrator, reads accounting
        records into the platform so they can be reported on, and can be
        revoked at any time from within QuickBooks or from the platform&rsquo;s
        health page. Revoking it stops all further reading of QuickBooks data.
        See the{" "}
        <a href="/legal/quickbooks-disconnect">disconnect instructions</a> for
        how to do this and what happens afterwards.
      </p>
      <p>
        Vendors and clients never receive access to the QuickBooks connection
        itself. They see only the specific records that concern them.
      </p>

      <h2>5. Your content</h2>
      <p>
        Documents you upload or submit, such as insurance certificates, W-9s,
        and signed lien waivers, remain yours. You grant P5 permission to store
        and use them for the purpose you supplied them: verifying compliance,
        processing payment, and meeting record-keeping obligations. We may
        retain them as long as our records, contracts, and applicable law
        require.
      </p>

      <h2>6. Accuracy, and what this software is not</h2>
      <p>
        The platform reports figures derived from accounting records, project
        budgets, and forecasts. Those figures are operational reporting, not a
        substitute for professional advice. Nothing in the platform is
        accounting, tax, legal, or investment advice, and no figure shown in it
        is a certified financial statement. Forecasts and recommendations are
        estimates that depend on the data entered and may be wrong. Decisions
        remain yours, and where they matter you should confirm them with a
        qualified accountant or attorney.
      </p>

      <h2>7. Availability</h2>
      <p>
        We do not promise uninterrupted availability. The platform may be
        unavailable for maintenance, upgrades, or reasons outside our control,
        including failures at our hosting or accounting providers.
      </p>

      <h2>8. Disclaimers and limits</h2>
      <p>
        The platform is provided &ldquo;as is&rdquo; and &ldquo;as
        available&rdquo;, without warranties of any kind, whether express or
        implied, including any implied warranty of merchantability, fitness for
        a particular purpose, or non-infringement, to the fullest extent
        permitted by Idaho law.
      </p>
      <p>
        To the fullest extent permitted by law, P5 is not liable for indirect,
        incidental, special, consequential, or punitive damages, or for lost
        profits, revenue, or data, arising from your use of the platform. This
        section does not limit any liability that cannot be limited by law, and
        it does not affect the separate written contracts between P5 and its
        clients, vendors, or subcontractors, which govern the underlying work.
        Where these terms and such a contract conflict, that contract controls.
      </p>

      <h2>9. Ending access</h2>
      <p>
        We may suspend or end access at any time, including when a working
        relationship ends or when these terms are breached. You may ask us to
        close your access at any time by writing to the address below.
      </p>

      <h2>10. Governing law</h2>
      <p>
        These terms are governed by the laws of the State of Idaho, without
        regard to its conflict-of-law rules. The state and federal courts
        serving Ada County, Idaho have exclusive jurisdiction over any dispute
        arising from them.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may update these terms. The date at the top of this page shows when
        they last changed. Continuing to use the platform after a change means
        you accept the updated terms.
      </p>

      <h2>12. Contact</h2>
      <p>Questions about these terms can go to the address below.</p>
    </>
  );
}

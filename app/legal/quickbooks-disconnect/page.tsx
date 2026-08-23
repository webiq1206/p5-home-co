import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Disconnecting QuickBooks | P5 Home Co",
  description:
    "How to disconnect the P5 Home Co finance platform from QuickBooks Online, and what happens when you do.",
  alternates: { canonical: "/legal/quickbooks-disconnect" },
};

export default function DisconnectPage() {
  return (
    <>
      <h1>Disconnecting QuickBooks</h1>
      <p className="legal-updated">Last updated 23 August 2026</p>

      <p className="legal-lead">
        The P5 Home Co finance platform connects to P5&rsquo;s QuickBooks Online
        company file to read accounting records. That connection can be ended at
        any time, from either side, and takes effect immediately.
      </p>

      <h2>From QuickBooks Online</h2>
      <ul>
        <li>Sign in to QuickBooks Online as an administrator.</li>
        <li>
          Open <strong>Settings</strong> (the gear icon) and choose{" "}
          <strong>Manage apps</strong>, or go to{" "}
          <a
            href="https://qbo.intuit.com/app/appcenter"
            rel="noreferrer noopener"
            target="_blank"
          >
            the Apps area
          </a>
          .
        </li>
        <li>
          Find <strong>P5 Finance OS</strong> in the list of connected apps.
        </li>
        <li>
          Choose <strong>Disconnect</strong> and confirm.
        </li>
      </ul>

      <h2>From the P5 platform</h2>
      <p>
        A P5 administrator can disconnect from{" "}
        <strong>Admin &rarr; Finance &rarr; Health</strong>, which shows the
        current connection status alongside every other integration and
        scheduled job.
      </p>

      <div className="legal-callout">
        <p>
          <strong>What happens when you disconnect.</strong> The stored access
          and refresh tokens are discarded, and the platform immediately stops
          reading anything further from QuickBooks. Accounting records already
          synced into the platform remain, because P5 needs them for its own
          project reporting, lien compliance, and tax records. Nothing is
          written back to QuickBooks as part of disconnecting, and no QuickBooks
          data is deleted.
        </p>
      </div>

      <h2>Reconnecting</h2>
      <p>
        A P5 administrator can reconnect from the same health page. Reconnecting
        starts a fresh authorisation in QuickBooks and issues new tokens; the
        old ones are never reused.
      </p>

      <h2>Requesting deletion</h2>
      <p>
        If you want the synced accounting data removed as well, write to the
        address below and we will confirm what can be deleted and what we are
        required to retain. Our{" "}
        <a href="/legal/privacy">privacy policy</a> explains those retention
        obligations.
      </p>
    </>
  );
}

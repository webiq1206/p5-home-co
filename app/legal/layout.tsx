import type { ReactNode } from "react";
import Link from "next/link";
import SiteChrome from "@/components/SiteChrome";
import "./legal.css";

/**
 * Chrome for the legal documents. Intuit requires the end-user licence
 * agreement and privacy policy to be publicly reachable pages before it will
 * issue production keys, so these live on the marketing site rather than
 * behind the admin login.
 *
 * They sit inside the same header and footer as every other page, so a reader
 * can always get back to the site. The footer carries the public identity
 * line (representative, address, hours, registration); the contact block
 * below keeps the legal entity and the accounting address.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <SiteChrome>
      <main className="legal-page">
        <Link className="legal-back" href="/">
          &larr; P5 Home Co
        </Link>
        {children}
        <div className="legal-contact">
          <p><strong>P5 Home Co. LLC</strong></p>
          <p>4031 W Wapoot St, Meridian, ID 83646</p>
          <p>
            <a href="mailto:accounting@p5homeco.com">accounting@p5homeco.com</a>
          </p>
        </div>
      </main>
    </SiteChrome>
  );
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | P5 Home Co",
  description:
    "How P5 Home Co collects, uses, shares, and protects personal information, including data accessed through QuickBooks Online.",
  alternates: { canonical: "/legal/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="legal-updated">Last updated 23 August 2026</p>

      <p className="legal-lead">
        P5 Home Co. LLC operates p5homeco.com and the private finance platform
        and portals hosted on it. This policy explains what information we
        collect, why, who we share it with, and how you can reach us about it.
      </p>

      <h2>1. Who we are</h2>
      <p>
        P5 Home Co. LLC is an Idaho limited liability company and the parent of
        Boise Construction Co, Boise Remodeling Co, Boise ADU Co, Boise Handyman
        Co, and Boise Cabinet Co. We are the controller of the information
        described here. Our contact details are at the bottom of this page.
      </p>

      <h2>2. Information we collect</h2>

      <h3>Visitors to the public website</h3>
      <ul>
        <li>
          Usage and device information collected by analytics cookies, such as
          pages viewed, referring site, approximate location, browser, and
          device type.
        </li>
        <li>
          Anything you choose to send us when you submit a project inquiry or
          contact us, typically your name, email address, phone number, project
          location, and a description of the work.
        </li>
      </ul>

      <h3>Vendors, subcontractors, and clients using the portals</h3>
      <ul>
        <li>
          Contact details for the person invited to the portal, such as name,
          business name, and email address.
        </li>
        <li>
          Compliance documents you provide, such as certificates of insurance,
          W-9 forms, licence details, and signed lien waivers.
        </li>
        <li>
          Records of your work with us: purchase orders, invoices, payment
          status, and the projects you are assigned to.
        </li>
        <li>
          Sign-in activity, including the single-use link issued to your email
          and the session created when you use it.
        </li>
      </ul>

      <h3>Accounting information from QuickBooks Online</h3>
      <p>
        With authorisation from a P5 administrator, the platform reads records
        from P5&rsquo;s own QuickBooks Online company file: chart of accounts,
        classes, customers, vendors, and transactions such as invoices, bills,
        purchase orders, and payments. These are P5&rsquo;s business records.
        Where they contain personal information, it is normally the business
        contact details of a customer or vendor.
      </p>

      <h3>Email correspondence</h3>
      <p>
        Where a P5 mailbox is connected to the platform, messages relating to a
        project or inquiry may be recorded against that record so the team has
        an accurate history of what was said and when.
      </p>

      <h2>3. Why we use it</h2>
      <ul>
        <li>To respond to inquiries and match a project to the right company.</li>
        <li>
          To run projects: budgets, purchase orders, invoicing, payment
          approvals, and lender draw packages.
        </li>
        <li>
          To verify that vendors and subcontractors carry current insurance and
          have returned the documents a job requires, before payment is
          released.
        </li>
        <li>
          To show each vendor and client their own status without exposing
          anyone else&rsquo;s.
        </li>
        <li>
          To meet our record-keeping, tax, insurance, and lien obligations.
        </li>
        <li>To secure the platform and investigate misuse.</li>
      </ul>

      <h2>4. Who we share it with</h2>
      <p>
        <strong>We do not sell personal information, and we do not share it for
        advertising.</strong> We share it only with:
      </p>
      <ul>
        <li>
          <strong>Service providers</strong> that run parts of the platform on
          our behalf, under contract, and only for that purpose: our hosting and
          database provider, our email delivery provider, Intuit (QuickBooks
          Online), our customer-relationship system, and our website analytics
          provider.
        </li>
        <li>
          <strong>Professional advisers</strong> such as our accountant,
          attorney, insurer, or lender, where a project or obligation requires
          it. A lender draw package, for example, contains the project figures
          and waiver status the lender requires to fund a draw.
        </li>
        <li>
          <strong>Authorities</strong> where the law requires it, or to
          establish, exercise, or defend legal claims.
        </li>
      </ul>

      <h2>5. Cookies and analytics</h2>
      <p>
        The public website uses analytics and marketing cookies to understand
        how the site is used and which inquiries come from where. You can block
        or delete cookies in your browser settings; the site will still work.
        The portals use a strictly necessary cookie to keep you signed in, which
        cannot be turned off without ending your session.
      </p>

      <h2>6. How long we keep it</h2>
      <p>
        Inquiry records are kept while we are in contact and for a reasonable
        period afterwards. Project, vendor, and accounting records are kept for
        as long as the contract, our insurance, Idaho lien law, and tax rules
        require, which is typically several years after a project completes.
        Sign-in links expire within minutes of being issued; portal sessions
        expire after a set period or when you sign out.
      </p>

      <h2>7. How we protect it</h2>
      <ul>
        <li>The site and portals are served over encrypted connections (HTTPS).</li>
        <li>
          Sign-in links and session identifiers are stored as one-way hashes,
          never in a readable form.
        </li>
        <li>
          The QuickBooks access and refresh tokens are encrypted at rest using
          AES-256-GCM, with a key held only in the server environment.
        </li>
        <li>
          Access is limited by role, and the portals are built so that a vendor
          or client can only ever be shown their own records.
        </li>
        <li>Administrative actions are recorded in an audit log.</li>
      </ul>
      <p>
        No system is perfectly secure, and we cannot guarantee absolute
        security, but we take these measures seriously and review them.
      </p>

      <h2>8. Your choices and rights</h2>
      <p>
        You can ask us what personal information we hold about you, ask us to
        correct it, ask us to delete it, or ask us to stop sending you
        marketing. Write to the address at the bottom of this page and we will
        respond within a reasonable time. Some information must be retained
        where the law, a contract, or an insurance or lien obligation requires
        it; if we cannot delete something, we will tell you why.
      </p>
      <p>
        Depending on where you live you may have additional rights, including
        the right not to be discriminated against for exercising them.
      </p>

      <h2>9. Children</h2>
      <p>
        The website and platform are for business use and are not directed at
        children under 13. We do not knowingly collect information from them.
      </p>

      <h2>10. Changes</h2>
      <p>
        We may update this policy. The date at the top of this page shows when
        it last changed. Material changes will be reflected here before they
        take effect.
      </p>

      <h2>11. Contact</h2>
      <p>
        To ask about this policy or exercise any of the rights above, contact us
        at the address below.
      </p>
    </>
  );
}

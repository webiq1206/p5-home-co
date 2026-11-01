import type { ReactNode } from "react";
import { SiteFooter } from "@/components/family/SiteFooter";
import { SiteHeader } from "@/components/family/SiteHeader";
import { SkipLink } from "@/components/family/SkipLink";
import { P5_GOOGLE_PROFILE_URL } from "@/lib/familyBrand";

/**
 * P5 Home Co pages inside the shared family chrome: skip link, header (with its
 * mobile menu), the page, and the footer. The header, menu and footer are the
 * family components configured by lib/familyBrand.ts; the mobile action bar and
 * the chrome analytics are mounted once in app/layout.tsx.
 *
 * With `main`, the page content is wrapped in the page's single <main>, so the
 * header and footer stay outside it and read as the banner and contentinfo
 * landmarks. Pages that render their own <main> omit it and get a skip-link
 * target in its place.
 */
export default function SiteChrome({
  children,
  main = false,
}: {
  children: ReactNode;
  main?: boolean;
}) {
  return (
    <>
      <SkipLink label="Skip to main content" />
      <SiteHeader />
      {main ? (
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      ) : (
        <>
          <span id="main-content" className="main-content-target" tabIndex={-1} />
          {children}
        </>
      )}
      <SiteFooter
        brandExtra={
          // P5 Home Co's Google Business Profile sits beside its Facebook page (owner call A).
          <ul className="fam-footer-contact">
            <li>
              <a href={P5_GOOGLE_PROFILE_URL} rel="noopener" target="_blank" data-testid="link-footer-google">
                P5 Home Co on Google
              </a>
            </li>
          </ul>
        }
      />
    </>
  );
}

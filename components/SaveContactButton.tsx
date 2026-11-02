"use client";

import { BUSINESS_VCARD_PATH } from "@/lib/vcard";
import { track } from "@/app/analytics";

/** One-tap "Save our contact" link (Phase 11). */
export default function SaveContactButton({
  className = "save-contact-button",
  location = "unknown",
  children = "Save our contact",
}: {
  className?: string;
  location?: string;
  children?: React.ReactNode;
}) {
  return (
    <a
      className={className}
      href={BUSINESS_VCARD_PATH}
      download="p5-home-co.vcf"
      onClick={() => track("save_contact", { location })}
    >
      <svg className="save-contact-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.33 0-10 1.67-10 5v1h20v-1c0-3.33-6.67-5-10-5Z"
        />
      </svg>
      <span>{children}</span>
    </a>
  );
}

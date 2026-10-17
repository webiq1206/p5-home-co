import type { ReactNode } from "react";
import {
  IDAHO_DOPL_LICENSE_SEARCH,
  PUBLIC_EMAIL,
  PUBLIC_NAP,
  PUBLIC_PHONE_DISPLAY,
  PUBLIC_PHONE_TEL,
  PUBLIC_REGISTRATION,
  SISTER_LINE,
  SISTER_LINKS,
} from "@/app/publicIdentity";

function withLinks(text: string, labels: readonly { label: string; href: string }[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let nextAt = -1;
    let next: { label: string; href: string } | null = null;
    for (const item of labels) {
      const at = text.indexOf(item.label, cursor);
      if (at !== -1 && (nextAt === -1 || at < nextAt)) {
        nextAt = at;
        next = item;
      }
    }
    if (!next || nextAt === -1) {
      nodes.push(text.slice(cursor));
      break;
    }
    if (nextAt > cursor) nodes.push(text.slice(cursor, nextAt));
    const external = next.href.startsWith("http");
    nodes.push(
      <a
        key={`${next.label}-${nextAt}`}
        href={next.href}
        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      >
        {next.label}
      </a>,
    );
    cursor = nextAt + next.label.length;
  }
  return nodes;
}

/** The approved NAP, registration, and sister-company row. Text content matches the audit strings.
 * Funnel pages pass linkRegistration={false} so the credential stays plain text. */
export default function PublicIdentity({
  tone = "inherit",
  linkRegistration = true,
}: {
  tone?: "inherit" | "ink";
  linkRegistration?: boolean;
}) {
  return (
    <div className={`public-identity${tone === "ink" ? " public-identity-ink" : ""}`}>
      <p className="public-nap">
        {withLinks(PUBLIC_NAP, [
          { label: PUBLIC_PHONE_DISPLAY, href: PUBLIC_PHONE_TEL },
          { label: PUBLIC_EMAIL, href: `mailto:${PUBLIC_EMAIL}` },
        ])}
      </p>
      <p className="public-registration">
        {linkRegistration ? (
          <a
            href={IDAHO_DOPL_LICENSE_SEARCH}
            target="_blank"
            rel="noopener noreferrer"
            title="Look up registration 8381215 on Idaho DOPL"
            aria-label="Verify with Idaho DOPL: look up registration 8381215, opens in a new tab"
          >
            {PUBLIC_REGISTRATION}
          </a>
        ) : (
          PUBLIC_REGISTRATION
        )}
      </p>
      <p className="sister-sites">{withLinks(SISTER_LINE, SISTER_LINKS)}</p>
    </div>
  );
}

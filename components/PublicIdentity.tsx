import type { ReactNode } from "react";
import {
  IDAHO_DOPL_PUBLIC_SEARCH,
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

/** The approved NAP, registration, and sister-company row. Text content matches the audit strings. */
export default function PublicIdentity({
  tone = "inherit",
  doplLink = true,
}: {
  tone?: "inherit" | "ink";
  /** When false, the registration line is plain text. Footer and legal pages leave this on. */
  doplLink?: boolean;
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
        {doplLink ? (
          <a href={IDAHO_DOPL_PUBLIC_SEARCH} target="_blank" rel="noopener">
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

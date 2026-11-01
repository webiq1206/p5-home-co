/**
 * Family proof strip (C14). SHARED FILE (lib/family/manifest.json).
 *
 * Three or four cells directly under the hero. Sourced facts only: every item
 * must already be published and defensible, and a cell that links (a licence or
 * registration lookup) links to the authority that confirms it. Omit the strip
 * rather than pad it.
 */
import { brandStyle } from './brandStyle';

export interface ProofItem {
  /** Short uppercase label, for example "Registered". */
  label: string;
  text: string;
  href?: string;
  /** Link title and accessible name, for lookups that open elsewhere. */
  linkTitle?: string;
  linkLabel?: string;
  /** Opens in a new tab (for third-party lookups). */
  newTab?: boolean;
}

export function ProofStrip({ items, label = 'At a glance' }: { items: ProofItem[]; label?: string }) {
  const cells = items.slice(0, 4);
  if (cells.length < 3) return null;
  return (
    <section className="fam-proof" aria-label={label} style={brandStyle()}>
      <ul className="fam-container fam-proof-list" data-count={cells.length}>
        {cells.map((item) => (
          <li className="fam-proof-cell" key={item.label}>
            <p className="fam-proof-label">{item.label}</p>
            <p className="fam-proof-text">
              {item.href ? (
                <a
                  href={item.href}
                  title={item.linkTitle}
                  aria-label={item.linkLabel}
                  target={item.newTab ? '_blank' : undefined}
                  rel={item.newTab ? 'noopener' : undefined}
                >
                  {item.text}
                </a>
              ) : (
                item.text
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

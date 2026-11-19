'use client';

/**
 * Footer section that folds on phones and tablets. SHARED FILE (lib/family/manifest.json).
 *
 * A native <details>: closed below the desktop breakpoint so the footer stays
 * short, with every link still in the HTML. At 1024px and up the section is
 * always open and its label is plain text again, so the desktop footer reads
 * as columns and rows exactly as before. The contact block, Save our contact
 * and the social links are never placed in a fold.
 */
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';

const WIDE = '(min-width: 1024px)';

export interface FooterFoldProps {
  label: string;
  className?: string;
  /** Marks the family row for the chrome checks. */
  familyRow?: boolean;
  children: ReactNode;
}

export function FooterFold({ label, className, familyRow = false, children }: FooterFoldProps) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = ref.current;
    if (!details || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(WIDE);
    const summary = details.querySelector('summary');
    const sync = () => {
      details.open = query.matches;
      if (summary) summary.tabIndex = query.matches ? -1 : 0;
    };
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  /** On desktop the label is not a control. */
  const keepOpen = (event: MouseEvent<HTMLElement>) => {
    if (typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches) event.preventDefault();
  };

  return (
    <details
      ref={ref}
      className={['fam-footer-fold', className].filter(Boolean).join(' ')}
      {...(familyRow ? { 'data-family-row': '' } : {})}
    >
      <summary className="fam-footer-label" onClick={keepOpen}>
        {label}
      </summary>
      {children}
    </details>
  );
}

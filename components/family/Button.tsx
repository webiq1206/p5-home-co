/**
 * Family buttons. SHARED FILE (lib/family/manifest.json).
 *
 * primary   charcoal fill, paper text, a 3px accent bar on the leading edge
 * secondary outline
 * tertiary  text link
 * hero      the primary on a photograph or dark ground: paper fill, charcoal text, accent bar
 *
 * Heights 48 / 44 / 36 (lg / md / sm), 16px label, square corners. tone="dark"
 * flips secondary and tertiary for dark grounds. Internal hrefs use next/link so
 * client navigation and router history stay intact.
 */
import Link from 'next/link';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { isExternal } from '@/lib/family/types';

export type FamilyButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'hero';
export type FamilyButtonSize = 'lg' | 'md' | 'sm';

export function familyButtonClass({
  variant = 'primary',
  size = 'md',
  tone = 'light',
  block = false,
  className,
}: {
  variant?: FamilyButtonVariant;
  size?: FamilyButtonSize;
  tone?: 'light' | 'dark';
  block?: boolean;
  className?: string;
}): string {
  return [
    'fam-btn',
    `fam-btn--${variant}`,
    `fam-btn--${size}`,
    tone === 'dark' ? 'fam-btn--on-dark' : '',
    block ? 'fam-btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

export interface FamilyButtonProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  variant?: FamilyButtonVariant;
  size?: FamilyButtonSize;
  tone?: 'light' | 'dark';
  block?: boolean;
  children: ReactNode;
}

export function FamilyButton({ href, variant, size, tone, block, className, children, ...rest }: FamilyButtonProps) {
  const cls = familyButtonClass({ variant, size, tone, block, className });
  const internal = href.startsWith('/') && !href.startsWith('//');
  if (internal) {
    return (
      <Link href={href} className={cls} {...rest}>
        {children}
      </Link>
    );
  }
  const external = isExternal(href);
  return (
    <a href={href} className={cls} rel={external ? rest.rel ?? 'noopener' : rest.rel} {...rest}>
      {children}
    </a>
  );
}

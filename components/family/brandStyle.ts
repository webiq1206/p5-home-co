/**
 * The brand accent as CSS custom properties. SHARED FILE (lib/family/manifest.json).
 * Every family component sets these on its own root from the brand config, so a
 * component renders in the right accent wherever a site places it.
 */
import type { CSSProperties } from 'react';
import { FAMILY_BRAND } from '@/lib/familyBrand';

export function brandStyle(): CSSProperties {
  return {
    '--color-accent': FAMILY_BRAND.accent,
    '--color-accent-ink': FAMILY_BRAND.accentInk,
  } as CSSProperties;
}

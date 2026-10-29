import {ESTIMATOR_BRAND} from './brand.ts';

/**
 * Visual theme for the estimator card. Each site keeps its own palette: the
 * family uses light cards on warm paper with brand-specific decorative accents
 * and separate accessible text tones. Tokens are consumed by P5Estimator.module.css.
 *
 * Accents match the approved brand system of 28 October 2026 (Phase 9).
 * accentInk is a darkened accent that reaches at least 4.5:1 on paper.
 */
export interface EstimatorTheme {
  mode:'dark'|'light';
  /** Brand accent used for progress, focus rings and highlights. */
  accent:string;
  /** Accent tone that stays readable as text on the card surface. */
  accentInk:string;
  /** Heading typeface matching the surrounding site. */
  headingFont:string;
}

const DARK_HEADING='var(--font-cormorant, "Cormorant Garamond", Georgia, serif)';

const THEMES:Record<string,EstimatorTheme>={
  p5:{mode:'light',accent:'#A58C72',accentInk:'#705A45',headingFont:DARK_HEADING},
  remodeling:{mode:'light',accent:'#7D9479',accentInk:'#4C5F50',headingFont:DARK_HEADING},
  construction:{mode:'light',accent:'#C48D3F',accentInk:'#805125',headingFont:DARK_HEADING},
  handyman:{mode:'light',accent:'#C56B4A',accentInk:'#92472C',headingFont:DARK_HEADING},
  cabinet:{mode:'light',accent:'#659B9A',accentInk:'#356363',headingFont:DARK_HEADING},
  adu:{mode:'light',accent:'#C97C99',accentInk:'#7A3F56',headingFont:DARK_HEADING},
};

export function estimatorTheme(brandId:string=ESTIMATOR_BRAND.id):EstimatorTheme{
  return THEMES[brandId]||{mode:'light',accent:ESTIMATOR_BRAND.accent,accentInk:'#705A45',headingFont:DARK_HEADING};
}

/** Inline CSS custom properties for the estimator root element. */
export function estimatorThemeStyle(theme:EstimatorTheme=estimatorTheme()):Record<string,string>{
  return {'--p5-accent':theme.accent,'--p5-accent-ink':theme.accentInk,'--p5-heading-font':theme.headingFont};
}

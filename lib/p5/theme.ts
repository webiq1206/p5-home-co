import {ESTIMATOR_BRAND} from './brand.ts';

/**
 * Visual theme for the estimator card. Each site keeps its own palette: the
 * family uses light cards on warm paper with brand-specific decorative accents
 * and separate accessible text tones. Tokens are consumed by P5Estimator.module.css.
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
  p5:{mode:'light',accent:'#D0B496',accentInk:'#486354',headingFont:'"P5 Serif", Georgia, serif'},
  remodeling:{mode:'light',accent:'#9AA098',accentInk:'#4C5F50',headingFont:DARK_HEADING},
  construction:{mode:'light',accent:'#D09A5C',accentInk:'#805125',headingFont:DARK_HEADING},
  handyman:{mode:'light',accent:'#8FAEC4',accentInk:'#365D76',headingFont:DARK_HEADING},
  cabinet:{mode:'light',accent:'#8FBEBE',accentInk:'#356363',headingFont:DARK_HEADING},
};

export function estimatorTheme(brandId:string=ESTIMATOR_BRAND.id):EstimatorTheme{
  return THEMES[brandId]||{mode:'light',accent:ESTIMATOR_BRAND.accent,accentInk:'#486354',headingFont:DARK_HEADING};
}

/** Inline CSS custom properties for the estimator root element. */
export function estimatorThemeStyle(theme:EstimatorTheme=estimatorTheme()):Record<string,string>{
  return {'--p5-accent':theme.accent,'--p5-accent-ink':theme.accentInk,'--p5-heading-font':theme.headingFont};
}

import {ESTIMATOR_BRAND} from './brand';

/**
 * Visual theme for the estimator card. Each site keeps its own palette: the
 * four Boise sites are dark, so the estimator is a raised dark surface with
 * the brand accent; P5 Home Co is a light site, so the estimator is a white
 * card on paper. Tokens are consumed by P5Estimator.module.css.
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
  remodeling:{mode:'dark',accent:'#9AA098',accentInk:'#B7BDB5',headingFont:DARK_HEADING},
  construction:{mode:'dark',accent:'#D09A5C',accentInk:'#E0B27A',headingFont:DARK_HEADING},
  handyman:{mode:'dark',accent:'#8FAEC4',accentInk:'#A9C3D5',headingFont:DARK_HEADING},
  cabinet:{mode:'dark',accent:'#8FBEBE',accentInk:'#A8CFCF',headingFont:DARK_HEADING},
};

export function estimatorTheme(brandId:string=ESTIMATOR_BRAND.id):EstimatorTheme{
  return THEMES[brandId]||{mode:'dark',accent:ESTIMATOR_BRAND.accent,accentInk:ESTIMATOR_BRAND.accent,headingFont:DARK_HEADING};
}

/** Inline CSS custom properties for the estimator root element. */
export function estimatorThemeStyle(theme:EstimatorTheme=estimatorTheme()):Record<string,string>{
  return {'--p5-accent':theme.accent,'--p5-accent-ink':theme.accentInk,'--p5-heading-font':theme.headingFont};
}

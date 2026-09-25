import styles from './P5Estimator.module.css';

interface EstimatorNavigationProps {
  brandName: string;
  stepLabel: string;
  showBack: boolean;
  frameActive: boolean;
  embedded: boolean;
  onBack: () => void;
  onExit?: () => void;
}

/** Site navigation must remain available without relying on browser history. */
export function P5EstimatorNavigation({brandName, stepLabel, showBack, frameActive, embedded, onBack, onExit}: EstimatorNavigationProps) {
  return <nav className={styles.topbar} aria-label="Estimator navigation">
    {showBack
      ? <button type="button" className={styles.navBtn} onClick={onBack} aria-label="Back to the previous step">Back</button>
      : <a className={styles.navBtn} href="/" aria-label="Back to the homepage">Home</a>}
    <a className={styles.topCenter} href="/" aria-label={`${brandName}, back to the homepage`}>
      <span className={styles.brandLine}><span data-brand>{brandName}</span><span data-sep aria-hidden="true"> · </span><span data-title>Project estimator</span></span>
      <span className={styles.stepPill}>{stepLabel}</span>
    </a>
    {frameActive
      ? onExit
        ? <button type="button" className={styles.navBtn} onClick={onExit} aria-label={embedded ? 'Exit full screen. Your progress is saved.' : 'Close the estimator. Your progress is saved.'}>Exit</button>
        : <a className={styles.navBtn} href="/" aria-label="Exit the estimator and return to the homepage. Your progress is saved.">Exit</a>
      : <span className={styles.navSpacer} aria-hidden="true"/>}
  </nav>;
}

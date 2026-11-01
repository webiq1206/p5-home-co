/**
 * Skip link, first focusable element on every page. SHARED FILE (lib/family/manifest.json).
 * Hidden until focused, then shown above the sticky header.
 */
export function SkipLink({ target = 'main-content', label = 'Skip to content' }: { target?: string; label?: string }) {
  return (
    <a className="fam-skip" href={`#${target}`}>
      {label}
    </a>
  );
}

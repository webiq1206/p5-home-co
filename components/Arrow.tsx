export default function Arrow({ diagonal = false, reverse = false }: { diagonal?: boolean; reverse?: boolean }) {
  return (
    <svg aria-hidden="true" className={`arrow${diagonal ? " arrow-diagonal" : ""}${reverse ? " arrow-reverse" : ""}`} viewBox="0 0 24 16" fill="none">
      {diagonal ? <><line x1="3" y1="13" x2="20" y2="2" /><polyline points="13 2 20 2 20 9" /></> : reverse ? <><line x1="21" y1="8" x2="3" y2="8" /><polyline points="9 2 3 8 9 14" /></> : <><line x1="3" y1="8" x2="21" y2="8" /><polyline points="15 2 21 8 15 14" /></>}
    </svg>
  );
}

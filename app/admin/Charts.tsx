/**
 * Chart primitives for the dashboard.
 *
 * Hand-rolled SVG and CSS rather than a charting dependency: the shapes needed
 * here are simple, and a server-rendered chart costs no client JavaScript on a
 * page people open on a phone between jobs.
 *
 * Every chart states its numbers in text as well as in the drawing. A bar
 * nobody can read the value of is decoration, and someone using a screen
 * reader gets the same figures as everyone else.
 */

const PALETTE = ["#233029", "#7a9184", "#ac7d55", "#5d7a6b", "#c2a37f", "#3f5347"];

export const CHART_COLORS = {
  ink: "#233029",
  sage: "#7a9184",
  bronze: "#ac7d55",
  alarm: "#9a2f2f",
  good: "#3f6b4f",
  line: "rgba(32, 35, 31, 0.15)",
};

export function seriesColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

// ---------------------------------------------------------------------------
// Horizontal labelled bars. The workhorse: pipeline by stage, lead sources,
// AR ageing - anything that is "a list of named amounts".
// ---------------------------------------------------------------------------

export type BarRow = {
  label: string;
  value: number;
  /** Shown on the right instead of the raw value, e.g. a money string. */
  display?: string;
  /** A second line under the label, e.g. "3 projects". */
  note?: string;
  color?: string;
};

export function BarRows({
  rows,
  emptyMessage = "Nothing to show yet.",
}: {
  rows: BarRow[];
  emptyMessage?: string;
}) {
  if (rows.length === 0) return <p className="dash-empty">{emptyMessage}</p>;
  // Scale to the largest bar, never to the total: the comparison people make
  // here is between rows, and a shared total flattens every small row to zero.
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);

  return (
    <ul className="dash-bars">
      {rows.map((row, i) => (
        <li key={`${row.label}-${i}`} className="dash-bar-row">
          <div className="dash-bar-head">
            <span className="dash-bar-label">
              {row.label}
              {row.note && <small>{row.note}</small>}
            </span>
            <span className="dash-bar-value">{row.display ?? row.value.toLocaleString()}</span>
          </div>
          <div className="dash-bar-track">
            <div
              className="dash-bar-fill"
              style={{
                width: `${Math.max((Math.abs(row.value) / max) * 100, row.value === 0 ? 0 : 1.5)}%`,
                background: row.color ?? seriesColor(i),
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Columns over time. Used for daily lead volume, where the shape of the week
// matters more than any single day's exact height.
// ---------------------------------------------------------------------------

/**
 * `label` has to survive being one of fourteen columns on a 375px phone, which
 * leaves room for about one character - so it is the weekday letter, and the
 * exact date rides along in `caption` for the hover title. Callers that need
 * the date on screen put it in a footnote under the chart, where it cannot
 * push the panel wider than the screen.
 */
export type Column = { label: string; value: number; caption?: string };

export function ColumnChart({
  columns,
  height = 120,
  color = CHART_COLORS.ink,
  emptyMessage = "No activity in this period.",
}: {
  columns: Column[];
  height?: number;
  color?: string;
  emptyMessage?: string;
}) {
  if (columns.length === 0) return <p className="dash-empty">{emptyMessage}</p>;
  const max = Math.max(...columns.map((c) => c.value), 1);
  const total = columns.reduce((sum, c) => sum + c.value, 0);

  if (total === 0) return <p className="dash-empty">{emptyMessage}</p>;

  return (
    <div className="dash-columns" style={{ ["--dash-col-h" as string]: `${height}px` }}>
      {columns.map((c, i) => (
        <div key={`${c.label}-${i}`} className="dash-column">
          <span className="dash-column-value">{c.value || ""}</span>
          <div className="dash-column-track">
            <div
              className="dash-column-fill"
              style={{
                height: `${(c.value / max) * 100}%`,
                background: c.value === 0 ? CHART_COLORS.line : color,
              }}
              title={`${c.caption ?? c.label}: ${c.value}`}
            />
          </div>
          <span className="dash-column-label">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One stacked bar plus a legend. Right for "these parts make up this whole" -
// cash by bucket, response outcomes - where a pie would be harder to read at
// phone width.
// ---------------------------------------------------------------------------

export type Segment = { label: string; value: number; display?: string; color?: string };

export function StackedBar({
  segments,
  emptyMessage = "Nothing to show yet.",
}: {
  segments: Segment[];
  emptyMessage?: string;
}) {
  const usable = segments.filter((s) => s.value > 0);
  const total = usable.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return <p className="dash-empty">{emptyMessage}</p>;

  return (
    <div className="dash-stack-wrap">
      <div className="dash-stack" role="img" aria-label={usable
        .map((s) => `${s.label}: ${s.display ?? s.value}`)
        .join(", ")}>
        {usable.map((s, i) => (
          <div
            key={`${s.label}-${i}`}
            className="dash-stack-part"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color ?? seriesColor(i) }}
            title={`${s.label}: ${s.display ?? s.value}`}
          />
        ))}
      </div>
      <ul className="dash-legend">
        {segments.map((s, i) => (
          <li key={`${s.label}-${i}`}>
            <span className="dash-swatch" style={{ background: s.color ?? seriesColor(i) }} />
            <span className="dash-legend-label">{s.label}</span>
            <span className="dash-legend-value">{s.display ?? s.value.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A trend line. Only drawn when there are at least two points: a single dot
// implies a trend that has not been measured yet.
// ---------------------------------------------------------------------------

export type TrendPoint = { label: string; value: number };

export function TrendLine({
  points,
  height = 130,
  emptyMessage = "Not enough history yet to show a trend.",
}: {
  points: TrendPoint[];
  height?: number;
  emptyMessage?: string;
}) {
  if (points.length < 2) return <p className="dash-empty">{emptyMessage}</p>;

  const width = 600;
  const padY = 14;
  const values = points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;

  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => padY + (1 - (v - min) / span) * (height - padY * 2);
  const zeroY = y(0);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${width},${zeroY.toFixed(1)} L0,${zeroY.toFixed(1)} Z`;
  const negative = values.some((v) => v < 0);
  const stroke = negative ? CHART_COLORS.alarm : CHART_COLORS.ink;

  return (
    <div className="dash-trend">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="dash-trend-svg"
        style={{ height }}
        role="img"
        aria-label={points.map((p) => `${p.label}: ${p.value}`).join(", ")}
      >
        <line
          x1="0"
          x2={width}
          y1={zeroY}
          y2={zeroY}
          stroke={CHART_COLORS.line}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <path d={area} fill={stroke} opacity="0.10" />
        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        {points.map((p, i) => (
          <circle
            key={`${p.label}-${i}`}
            cx={x(i)}
            cy={y(p.value)}
            r="3"
            fill={p.value < 0 ? CHART_COLORS.alarm : stroke}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="dash-trend-axis">
        <span>{points[0].label}</span>
        <span>{points[points.length - 1].label}</span>
      </div>
    </div>
  );
}

import { useId, useMemo, useState } from 'react';

/**
 * Two series over time: findings raised against findings resolved.
 *
 * The palette was checked with the data-viz validator against the dark chart
 * surface. `#8b5cf6` and `#13a89a` pass the lightness band, the chroma floor,
 * CVD separation, the normal vision floor, and contrast.
 *
 * One y axis only. Both series count the same thing, so they share a scale.
 */

type Point = { date: Date; added: number; resolved: number };

const SERIES = [
  { key: 'added' as const, label: 'Raised', color: '#8b5cf6' },
  { key: 'resolved' as const, label: 'Resolved', color: '#13a89a' },
];

const W = 760;
const H = 240;
const PAD = { top: 16, right: 52, bottom: 28, left: 40 };

const shortDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function TrendChart({ data }: { data: Point[] }) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const max = Math.max(...data.flatMap((d) => [d.added, d.resolved]));
    const top = Math.ceil(max / 20) * 20;
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (i / (data.length - 1)) * plotW;
    const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

    const line = (key: 'added' | 'resolved') => data.map((d, i) => `${i ? 'L' : 'M'} ${x(i)},${y(d[key])}`).join(' ');
    const area = (key: 'added' | 'resolved') =>
      `${line(key)} L ${x(data.length - 1)},${PAD.top + plotH} L ${x(0)},${PAD.top + plotH} Z`;

    return { top, plotW, plotH, x, y, line, area, ticks: [0, top / 2, top] };
  }, [data]);

  const active = hover === null ? null : data[hover];

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = ((event.clientX - rect.left) / rect.width) * W;
    const step = geometry.plotW / (data.length - 1);
    const index = Math.round((ratio - PAD.left) / step);
    setHover(Math.max(0, Math.min(data.length - 1, index)));
  }

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <div>
          <h3>Findings raised and resolved</h3>
          <p>Last 30 days. Resolved has led raised for 11 days.</p>
        </div>
        {/* A legend is always present for two or more series. */}
        <ul className="legend">
          {SERIES.map((s) => (
            <li key={s.key}>
              <span className="legend-swatch" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      </figcaption>

      <div className="chart-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Line chart of findings raised and resolved over the last 30 days"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {/* Recessive grid. */}
          {geometry.ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={geometry.y(t)}
                y2={geometry.y(t)}
                stroke="currentColor"
                strokeOpacity={0.12}
              />
              <text x={PAD.left - 10} y={geometry.y(t) + 4} textAnchor="end" className="chart-tick">
                {t}
              </text>
            </g>
          ))}

          {SERIES.map((s) => (
            <path key={`fill-${s.key}`} d={geometry.area(s.key)} fill={`url(#${uid}-${s.key})`} />
          ))}
          {SERIES.map((s) => (
            <path
              key={`line-${s.key}`}
              d={geometry.line(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Direct end labels, so identity never rests on colour alone. */}
          {SERIES.map((s) => (
            <text
              key={`tag-${s.key}`}
              x={W - PAD.right + 8}
              y={geometry.y(data[data.length - 1][s.key]) + 4}
              className="chart-endlabel"
              fill={s.color}
            >
              {data[data.length - 1][s.key]}
            </text>
          ))}

          {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
            <text key={i} x={geometry.x(i)} y={H - 8} textAnchor="middle" className="chart-tick">
              {shortDate(data[i].date)}
            </text>
          ))}

          {hover !== null && (
            <g pointerEvents="none">
              <line
                x1={geometry.x(hover)}
                x2={geometry.x(hover)}
                y1={PAD.top}
                y2={PAD.top + geometry.plotH}
                stroke="currentColor"
                strokeOpacity={0.35}
              />
              {SERIES.map((s) => (
                <circle
                  key={s.key}
                  cx={geometry.x(hover)}
                  cy={geometry.y(data[hover][s.key])}
                  r={5}
                  fill={s.color}
                  stroke="var(--panel)"
                  strokeWidth={2}
                />
              ))}
            </g>
          )}
        </svg>

        {active && (
          <div
            className="chart-tooltip"
            style={{ left: `${(geometry.x(hover!) / W) * 100}%` }}
            role="status"
          >
            <strong>{shortDate(active.date)}</strong>
            {SERIES.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} aria-hidden="true" />
                {s.label}
                <b>{active[s.key]}</b>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Table alternative for anyone who cannot use the plot. */}
      <details className="chart-table">
        <summary>View as table</summary>
        <div className="table-scroll">
          <table>
            <caption>Findings raised and resolved, last 30 days</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Raised</th>
                <th scope="col">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date.toISOString()}>
                  <th scope="row">{shortDate(d.date)}</th>
                  <td>{d.added}</td>
                  <td>{d.resolved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

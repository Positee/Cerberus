import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CircleAlert, CircleCheck, CircleX } from 'lucide-react';
import TrendChart from '../app/TrendChart';
import {
  SEVERITY_LABEL,
  activity,
  exposedAssets,
  kpis,
  scanners,
  severityBreakdown,
  trend,
} from '../app/data';

const RANGES = ['7 days', '30 days', '90 days'];

const SCANNER_STATE = {
  healthy: { icon: CircleCheck, label: 'Healthy' },
  degraded: { icon: CircleAlert, label: 'Degraded' },
  offline: { icon: CircleX, label: 'Offline' },
} as const;

export default function Dashboard() {
  const [range, setRange] = useState('30 days');
  const total = severityBreakdown.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="page">
      {/* Filters sit in one row above the charts. */}
      <div className="filter-row">
        <div className="segmented" role="group" aria-label="Time range">
          {RANGES.map((option) => (
            <button
              key={option}
              type="button"
              className={range === option ? 'active' : ''}
              aria-pressed={range === option}
              onClick={() => setRange(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <p className="filter-note">Scope: all assets. Last sync 12 minutes ago.</p>
      </div>

      <section className="kpi-row" aria-label="Key numbers">
        {kpis.map((kpi) => {
          const falling = kpi.delta < 0;
          const Arrow = falling ? ArrowDownRight : ArrowUpRight;
          return (
            <article className="kpi" key={kpi.id}>
              <p className="kpi-label">{kpi.label}</p>
              <p className="kpi-value">{kpi.value}</p>
              <p className={kpi.good ? 'kpi-delta good' : 'kpi-delta bad'}>
                <Arrow size={14} aria-hidden="true" />
                {Math.abs(kpi.delta)}%
                <span>{kpi.note}</span>
              </p>
            </article>
          );
        })}
      </section>

      <section className="panel-grid">
        <div className="panel wide">
          <TrendChart data={trend} />
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Open findings by severity</h3>
            <p>{total.toLocaleString()} open in total.</p>
          </div>
          {/* Every bar carries its name and count, so severity is never encoded
              by colour alone. */}
          <ul className="severity-list">
            {severityBreakdown.map((row) => (
              <li key={row.id}>
                <div className="severity-top">
                  <span className="severity-name">
                    <i className={`sev-dot sev-${row.id}`} aria-hidden="true" />
                    {SEVERITY_LABEL[row.id]}
                  </span>
                  <span className="severity-count">{row.count}</span>
                </div>
                <div className="severity-track">
                  <span className={`sev-fill sev-${row.id}`} style={{ width: `${(row.count / total) * 100}%` }} />
                </div>
                <p className="severity-note">
                  {row.slaBreached > 0 ? `${row.slaBreached} past the remediation SLA` : 'All inside the SLA'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel-grid">
        <div className="panel wide">
          <div className="panel-head">
            <h3>Most exposed assets</h3>
            <p>Ranked by open critical findings.</p>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col">Type</th>
                  <th scope="col">Owner</th>
                  <th scope="col" className="num">Critical</th>
                  <th scope="col" className="num">High</th>
                  <th scope="col">Last scan</th>
                </tr>
              </thead>
              <tbody>
                {exposedAssets.map((asset) => (
                  <tr key={asset.name}>
                    <th scope="row">{asset.name}</th>
                    <td>{asset.kind}</td>
                    <td>{asset.owner}</td>
                    <td className="num">
                      <span className="count-chip sev-critical">{asset.critical}</span>
                    </td>
                    <td className="num">
                      <span className="count-chip sev-high">{asset.high}</span>
                    </td>
                    <td className="muted">{asset.lastScan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Scanner health</h3>
            <p>Six connected sources.</p>
          </div>
          <ul className="status-list">
            {scanners.map((scanner) => {
              const state = SCANNER_STATE[scanner.state];
              const Icon = state.icon;
              return (
                <li key={scanner.name}>
                  {/* Status ships with an icon and a word, never colour alone. */}
                  <Icon size={16} className={`state-${scanner.state}`} aria-hidden="true" />
                  <span className="status-name">
                    <strong>{scanner.name}</strong>
                    <small>{scanner.detail}</small>
                  </span>
                  <span className={`state-tag state-${scanner.state}`}>{state.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Recent activity</h3>
          <p>Everything your team and Cerberus changed today.</p>
        </div>
        <ul className="feed">
          {activity.map((row, index) => (
            <li key={index}>
              <span className="feed-actor">{row.who}</span>
              <span className="feed-body">
                {row.what} <strong>{row.target}</strong>
              </span>
              <span className="feed-when">{row.when}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

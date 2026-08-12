import { useState } from 'react';
import { CircleCheck, CircleX, Download } from 'lucide-react';
import { auditLog } from '../app/data';

const FILTERS = ['All events', 'Allowed', 'Denied'];

export default function Audit() {
  const [filter, setFilter] = useState('All events');

  const rows = auditLog.filter((row) => {
    if (filter === 'Allowed') return row.result === 'allowed';
    if (filter === 'Denied') return row.result === 'denied';
    return true;
  });

  return (
    <div className="page">
      <div className="filter-row">
        <div className="segmented" role="group" aria-label="Result">
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              className={filter === option ? 'active' : ''}
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <button type="button" className="ghost-button">
          <Download size={14} aria-hidden="true" />
          Export CSV
        </button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Audit log</h3>
          <p>Every privileged action, kept for 400 days.</p>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Resource</th>
                <th scope="col">Source IP</th>
                <th scope="col">When</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <th scope="row">{row.actor}</th>
                  <td>
                    <code>{row.action}</code>
                  </td>
                  <td>{row.resource}</td>
                  <td className="muted">{row.ip}</td>
                  <td className="muted">{row.at}</td>
                  <td>
                    {/* Icon plus word. The colour is support, not the message. */}
                    <span className={row.result === 'allowed' ? 'state-tag state-healthy' : 'state-tag state-offline'}>
                      {row.result === 'allowed' ? (
                        <CircleCheck size={13} aria-hidden="true" />
                      ) : (
                        <CircleX size={13} aria-hidden="true" />
                      )}
                      {row.result === 'allowed' ? 'Allowed' : 'Denied'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

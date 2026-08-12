import { CalendarClock, Download, Plus } from 'lucide-react';
import { reports } from '../app/data';

export default function Reporting() {
  return (
    <div className="page">
      <div className="filter-row">
        <p className="filter-note">Four scheduled reports. Cerberus builds each one from live findings.</p>
        <button type="button" className="primary-button">
          <Plus size={16} aria-hidden="true" />
          New report
        </button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Scheduled reports</h3>
          <p>Each report writes to your evidence store and emails the owners.</p>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Report</th>
                <th scope="col">Scope</th>
                <th scope="col">Cadence</th>
                <th scope="col">Format</th>
                <th scope="col">Next run</th>
                <th scope="col" className="num">Action</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.name}>
                  <th scope="row">{report.name}</th>
                  <td>{report.scope}</td>
                  <td>
                    <span className="count-chip neutral">
                      <CalendarClock size={12} aria-hidden="true" />
                      {report.cadence}
                    </span>
                  </td>
                  <td className="muted">{report.format}</td>
                  <td className="muted">{report.next}</td>
                  <td className="num">
                    <button type="button" className="ghost-button">
                      <Download size={14} aria-hidden="true" />
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="empty-note">
        <h3>Build a custom report</h3>
        <p>
          Choose a scope, a severity floor, and a cadence. Cerberus writes the evidence pack and keeps every past run
          for your auditors.
        </p>
      </section>
    </div>
  );
}

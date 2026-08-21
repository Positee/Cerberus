import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, Route, Send } from 'lucide-react';
import { getNotificationPolicy, listAlertRules, listContactPoints } from '../../app/api';
import { SEVERITY_LABEL } from '../../../shared/severity';
import { TRIGGER_LABEL, type AlertRule, type ContactPoint } from '../../../shared/alerting';

/**
 * The alerting landing page.
 *
 * Three surfaces, and the rules that already exist. A person opening this
 * wants to see what is set up, not a lesson.
 */

type Loaded = {
  rules: AlertRule[];
  contactPoints: ContactPoint[];
  routes: number;
  defaultContactPointId: string | null;
};

function describe(rule: AlertRule): string {
  const parts = [TRIGGER_LABEL[rule.condition.trigger].toLowerCase()];
  if (rule.condition.severity) parts.push(`severity is ${SEVERITY_LABEL[rule.condition.severity]}`);
  if (rule.condition.source) parts.push(`source is ${rule.condition.source}`);
  if (rule.condition.assetKind) parts.push(`asset is ${rule.condition.assetKind}`);
  return parts.join(', and ');
}

export default function Alerting() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;

    Promise.all([listAlertRules(), listContactPoints(), getNotificationPolicy()])
      .then(([rules, points, policy]) => {
        if (!alive) return;
        setLoaded({
          rules: rules.rules,
          contactPoints: points.contactPoints,
          routes: policy.routes.length,
          defaultContactPointId: policy.defaultContactPointId,
        });
      })
      .catch(() => {
        if (alive) setFailed(true);
      });

    return () => {
      alive = false;
    };
  }, []);

  const cards = [
    {
      to: '/alerting/rules',
      icon: BellRing,
      title: 'Alert rules',
      blurb: 'Decide what is worth waking somebody about.',
      count: loaded && `${loaded.rules.length} rules, ${loaded.rules.filter((r) => r.enabled).length} on`,
    },
    {
      to: '/alerting/contact-points',
      icon: Send,
      title: 'Contact points',
      blurb: 'Decide how a person hears about it. Email, chat, or a phone call.',
      count: loaded && `${loaded.contactPoints.length} contact points`,
    },
    {
      to: '/alerting/policies',
      icon: Route,
      title: 'Notification policies',
      blurb: 'Decide which alert reaches which contact point.',
      count:
        loaded &&
        `${loaded.routes} routes${loaded.defaultContactPointId ? '' : ', no default set'}`,
    },
  ];

  return (
    <div className="page">
      <section className="alerting-cards">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link className="alerting-card" to={card.to} key={card.to}>
              <span className="alerting-card-head">
                <Icon size={18} aria-hidden="true" />
                <strong>{card.title}</strong>
              </span>
              <p>{card.blurb}</p>
              <span className="alerting-count">{card.count ?? ' '}</span>
            </Link>
          );
        })}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Your rules</h3>
          <p>Everything set up in this workspace.</p>
        </div>

        {failed ? (
          <p className="field-hint">Cerberus cannot load the rules right now.</p>
        ) : loaded === null ? (
          // Placeholders, so the panel holds its shape while the rules arrive.
          <ul className="rule-list">
            {[0, 1, 2].map((row) => (
              <li key={row} aria-hidden="true">
                <span className="rule-main">
                  <span className="skeleton skeleton-title" />
                  <span className="skeleton skeleton-line" />
                </span>
              </li>
            ))}
          </ul>
        ) : loaded.rules.length === 0 ? (
          <div className="rule-empty">
            <p>No rules yet. This is where each one will sit once you set it up.</p>
            <Link className="primary-button" to="/alerting/rules">
              Create the first rule
            </Link>
          </div>
        ) : (
          <ul className="rule-list">
            {loaded.rules.map((rule) => (
              <li key={rule.id}>
                <span className="rule-main">
                  <strong>
                    <i className={`sev-dot sev-${rule.severity}`} aria-hidden="true" />
                    {rule.name}
                    <span className={rule.enabled ? 'state-tag state-healthy' : 'state-tag'}>
                      {rule.enabled ? 'On' : 'Off'}
                    </span>
                  </strong>
                  <small>{describe(rule)}</small>
                  {Object.keys(rule.labels).length > 0 && (
                    <span className="label-row">
                      {Object.entries(rule.labels).map(([key, value]) => (
                        <code key={key}>
                          {key}={value}
                        </code>
                      ))}
                    </span>
                  )}
                </span>
                <Link className="ghost-button" to="/alerting/rules">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="empty-note">
        <h3>Nothing fires yet</h3>
        <p>
          Cerberus stores these rules but does not evaluate them, because ingestion does not exist yet. Set them up
          now and they run the day findings start arriving.
        </p>
      </section>
    </div>
  );
}

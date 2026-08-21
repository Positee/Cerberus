import { FormEvent, useEffect, useState } from 'react';
import { Check, Plus, Trash2, TriangleAlert } from 'lucide-react';
import {
  ApiFailure,
  getNotificationPolicy,
  listContactPoints,
  saveNotificationPolicy,
} from '../../app/api';
import { allows, type Session } from '../../app/session';
import { routeFor, type ContactPoint, type Matcher, type NotificationPolicy } from '../../../shared/alerting';

/**
 * Notification policies.
 *
 * The default catches anything no route claims, so an alert is never silently
 * dropped. The tester at the bottom runs the same routeFor the API runs, so
 * what it shows is what would happen.
 */

type DraftRoute = {
  matchers: Matcher[];
  contactPointId: string;
  continueMatching: boolean;
};

const TIMINGS = [
  {
    key: 'groupWaitSeconds' as const,
    label: 'Group wait',
    blurb: 'Collect the first batch for this long before sending.',
  },
  {
    key: 'groupIntervalSeconds' as const,
    label: 'Group interval',
    blurb: 'Wait this long before sending an update to an open group.',
  },
  {
    key: 'repeatIntervalSeconds' as const,
    label: 'Repeat interval',
    blurb: 'Say it again after this long if nobody resolves it.',
  },
];

export default function NotificationPolicies({ session }: { session: Session }) {
  const editable = allows(session, 'alert.manage');

  const [points, setPoints] = useState<ContactPoint[]>([]);
  const [policy, setPolicy] = useState<NotificationPolicy | null>(null);
  const [routes, setRoutes] = useState<DraftRoute[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [probe, setProbe] = useState('severity=critical');

  useEffect(() => {
    let alive = true;

    Promise.all([getNotificationPolicy(), listContactPoints()])
      .then(([loaded, list]) => {
        if (!alive) return;
        setPolicy(loaded);
        setPoints(list.contactPoints);
        setRoutes(
          loaded.routes.map((route) => ({
            matchers: route.matchers,
            contactPointId: route.contactPointId,
            continueMatching: route.continueMatching,
          })),
        );
      })
      .catch((caught) => {
        if (alive) setError(caught instanceof ApiFailure ? caught.message : 'Cerberus cannot load the policy.');
      });

    return () => {
      alive = false;
    };
  }, []);

  const nameOf = (id: string | null) => points.find((point) => point.id === id)?.name ?? 'Nobody';

  function patchPolicy(change: Partial<NotificationPolicy>) {
    setPolicy((prev) => (prev ? { ...prev, ...change } : prev));
  }

  function move(index: number, by: number) {
    setRoutes((prev) => {
      const next = [...prev];
      const target = index + by;
      if (target < 0 || target >= next.length) return prev;
      const moved = next[index];
      const other = next[target];
      if (!moved || !other) return prev;
      next[index] = other;
      next[target] = moved;
      return next;
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!policy) return;

    setBusy(true);
    setError(null);
    setNote(null);

    try {
      const saved = await saveNotificationPolicy({
        defaultContactPointId: policy.defaultContactPointId,
        groupBy: policy.groupBy,
        groupWaitSeconds: policy.groupWaitSeconds,
        groupIntervalSeconds: policy.groupIntervalSeconds,
        repeatIntervalSeconds: policy.repeatIntervalSeconds,
        routes: routes.map((route, index) => ({ ...route, position: index })),
      });
      setPolicy(saved);
      setNote('The policy is saved.');
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  // The tester runs the shared rule, so it agrees with the API by construction.
  const probeLabels: Record<string, string> = {};
  for (const line of probe.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) probeLabels[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }

  const outcome = policy
    ? routeFor(probeLabels, {
        ...policy,
        routes: routes.map((route, index) => ({ ...route, id: String(index), position: index })),
      })
    : null;

  // The error has to render here too. Behind the early return it was
  // unreachable, so a failed load showed "Loading" for ever.
  if (!policy) {
    return (
      <div className="page profile-page">
        {error ? (
          <p className="auth-error" role="alert">
            <TriangleAlert size={15} aria-hidden="true" />
            {error}
          </p>
        ) : (
          <section className="panel">
            <div className="panel-head">
              <h3>Notification policies</h3>
              <p>Loading the routing.</p>
            </div>
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line" />
          </section>
        )}
      </div>
    );
  }

  return (
    <form className="page profile-page" onSubmit={save}>
      {error && (
        <p className="auth-error" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          {error}
        </p>
      )}
      {note && !error && (
        <p className="save-note" role="status">
          <Check size={15} aria-hidden="true" />
          {note}
        </p>
      )}

      {points.length === 0 && (
        <p className="policy-note">
          <TriangleAlert size={15} aria-hidden="true" />
          There are no contact points yet, so nothing can receive an alert. Make one first.
        </p>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3>Default policy</h3>
          <p>Anything no route claims lands here, so an alert is never dropped.</p>
        </div>

        <div className="stack-fields">
          <label className="field plain">
            <span>Send to</span>
            <select
              value={policy.defaultContactPointId ?? ''}
              disabled={!editable}
              onChange={(event) => patchPolicy({ defaultContactPointId: event.target.value || null })}
            >
              <option value="">Nobody</option>
              {points.map((point) => (
                <option key={point.id} value={point.id}>
                  {point.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field plain">
            <span>Group by</span>
            <input
              value={policy.groupBy.join(', ')}
              disabled={!editable}
              onChange={(event) =>
                patchPolicy({
                  groupBy: event.target.value
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
              placeholder="severity, source"
            />
            <small className="field-hint">Alerts sharing these label values arrive as one message.</small>
          </label>

          <div className="split-fields">
            {TIMINGS.map((timing) => (
              <label className="field plain" key={timing.key}>
                <span>{timing.label}</span>
                <input
                  type="number"
                  min={0}
                  value={policy[timing.key]}
                  disabled={!editable}
                  onChange={(event) => patchPolicy({ [timing.key]: Number(event.target.value) })}
                />
                <small className="field-hint">{timing.blurb}</small>
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Routes</h3>
          <p>Tested from the top. The first match wins unless it says to keep going.</p>
        </div>

        {routes.length === 0 ? (
          <p className="field-hint">No routes. Everything goes to the default.</p>
        ) : (
          <ul className="route-list">
            {routes.map((route, index) => (
              <li key={index}>
                <div className="route-head">
                  <span className="route-position">{index + 1}</span>
                  <span className="route-arrow">sends to</span>
                  <select
                    value={route.contactPointId}
                    disabled={!editable}
                    onChange={(event) =>
                      setRoutes((prev) =>
                        prev.map((row, at) =>
                          at === index ? { ...row, contactPointId: event.target.value } : row,
                        ),
                      )
                    }
                  >
                    {points.map((point) => (
                      <option key={point.id} value={point.id}>
                        {point.name}
                      </option>
                    ))}
                  </select>

                  {editable && (
                    <span className="route-controls">
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        Earlier
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={index === routes.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        Later
                      </button>
                      <button
                        type="button"
                        className="ghost-icon-button"
                        aria-label="Delete this route"
                        onClick={() => setRoutes((prev) => prev.filter((_, at) => at !== index))}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </div>

                <div className="matcher-rows">
                  {route.matchers.map((matcher, at) => (
                    <div className="matcher-row" key={at}>
                      <input
                        value={matcher.label}
                        disabled={!editable}
                        placeholder="severity"
                        onChange={(event) =>
                          setRoutes((prev) =>
                            prev.map((row, r) =>
                              r === index
                                ? {
                                    ...row,
                                    matchers: row.matchers.map((m, i) =>
                                      i === at ? { ...m, label: event.target.value } : m,
                                    ),
                                  }
                                : row,
                            ),
                          )
                        }
                      />
                      <select
                        value={matcher.operator}
                        disabled={!editable}
                        onChange={(event) =>
                          setRoutes((prev) =>
                            prev.map((row, r) =>
                              r === index
                                ? {
                                    ...row,
                                    matchers: row.matchers.map((m, i) =>
                                      i === at ? { ...m, operator: event.target.value as Matcher['operator'] } : m,
                                    ),
                                  }
                                : row,
                            ),
                          )
                        }
                      >
                        <option value="=">is</option>
                        <option value="!=">is not</option>
                      </select>
                      <input
                        value={matcher.value}
                        disabled={!editable}
                        placeholder="critical"
                        onChange={(event) =>
                          setRoutes((prev) =>
                            prev.map((row, r) =>
                              r === index
                                ? {
                                    ...row,
                                    matchers: row.matchers.map((m, i) =>
                                      i === at ? { ...m, value: event.target.value } : m,
                                    ),
                                  }
                                : row,
                            ),
                          )
                        }
                      />
                      {editable && (
                        <button
                          type="button"
                          className="ghost-icon-button"
                          aria-label="Remove this test"
                          onClick={() =>
                            setRoutes((prev) =>
                              prev.map((row, r) =>
                                r === index ? { ...row, matchers: row.matchers.filter((_, i) => i !== at) } : row,
                              ),
                            )
                          }
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}

                  {editable && (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() =>
                        setRoutes((prev) =>
                          prev.map((row, r) =>
                            r === index
                              ? { ...row, matchers: [...row.matchers, { label: '', operator: '=', value: '' }] }
                              : row,
                          ),
                        )
                      }
                    >
                      <Plus size={13} aria-hidden="true" />
                      Add a test
                    </button>
                  )}
                </div>

                <label className="switch-row compact">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={route.continueMatching}
                    disabled={!editable}
                    onChange={(event) =>
                      setRoutes((prev) =>
                        prev.map((row, at) =>
                          at === index ? { ...row, continueMatching: event.target.checked } : row,
                        ),
                      )
                    }
                  />
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                  <span className="switch-text">
                    <strong>Keep testing later routes</strong>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {editable && points.length > 0 && (
          <div className="panel-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() =>
                setRoutes((prev) => [
                  ...prev,
                  {
                    matchers: [{ label: 'severity', operator: '=', value: 'critical' }],
                    contactPointId: points[0]?.id ?? '',
                    continueMatching: false,
                  },
                ])
              }
            >
              <Plus size={14} aria-hidden="true" />
              Add a route
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Try it</h3>
          <p>Type the labels an alert would carry. This runs the rule the API runs.</p>
        </div>

        <label className="field plain">
          <span>Labels</span>
          <textarea rows={3} value={probe} onChange={(event) => setProbe(event.target.value)} />
        </label>

        <p className="save-note" role="status">
          <Check size={15} aria-hidden="true" />
          {outcome && outcome.contactPointIds.length > 0
            ? `This reaches ${outcome.contactPointIds.map(nameOf).join(', ')}.`
            : 'Nothing receives this. Set a default contact point.'}
        </p>
      </section>

      {editable && (
        <div className="panel-actions">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? 'Saving' : 'Save policy'}
          </button>
        </div>
      )}
    </form>
  );
}

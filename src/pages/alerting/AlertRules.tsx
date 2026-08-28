import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import {
  ApiFailure,
  createAlertRule,
  deleteAlertRule,
  listAlertRules,
  updateAlertRule,
} from '../../app/api';
import { allows, type Session } from '../../app/session';
import { useToast } from '../../app/toast';
import { useConfirm } from '../../app/confirm';
import { SEVERITY_LABEL, SEVERITY_ORDER, type Severity } from '../../../shared/severity';
import {
  DEFAULT_CONDITION,
  TRIGGER_BLURB,
  TRIGGER_LABEL,
  type AlertCondition,
  type AlertRule,
  type AlertTrigger,
} from '../../../shared/alerting';

/**
 * Alert rules.
 *
 * The editor reads as one sentence, top to bottom, so a person can check what
 * a rule does without holding the whole form in their head.
 */

const TRIGGERS = Object.keys(TRIGGER_LABEL) as AlertTrigger[];
const SOURCES = ['Trivy', 'Semgrep', 'Wazuh', 'Falco', 'osquery', 'Prowler'];
const ASSET_KINDS = ['Repository', 'Cluster', 'Container', 'Cloud account'];

type Draft = {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  severity: Severity;
  condition: AlertCondition;
  labelText: string;
};

function blankDraft(): Draft {
  return {
    id: null,
    name: '',
    description: '',
    enabled: true,
    severity: 'critical',
    condition: { ...DEFAULT_CONDITION },
    labelText: 'severity=critical',
  };
}

function toDraft(rule: AlertRule): Draft {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? '',
    enabled: rule.enabled,
    severity: rule.severity,
    condition: rule.condition,
    labelText: Object.entries(rule.labels)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  };
}

/** Reads one `key=value` per line. A line without an equals sign is skipped. */
function parseLabels(text: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (key) labels[key] = value;
  }
  return labels;
}

/** Turns a condition into the sentence the list shows. */
function describe(condition: AlertCondition): string {
  const parts = [TRIGGER_LABEL[condition.trigger].toLowerCase()];

  if (condition.severity) parts.push(`severity is ${SEVERITY_LABEL[condition.severity]}`);
  if (condition.source) parts.push(`source is ${condition.source}`);
  if (condition.assetKind) parts.push(`asset is ${condition.assetKind}`);
  if (condition.count > 1) parts.push(`${condition.count} times in ${condition.windowMinutes} minutes`);

  return parts.join(', and ');
}

/**
 * Picks one value, or Any.
 *
 * One rule answers one question. Choosing two severities at once would make
 * the label the rule fires with ambiguous, so the choice is exclusive.
 */
function OneOf({
  options,
  value,
  anyLabel,
  onPick,
  render,
}: {
  options: string[];
  value: string | null;
  anyLabel: string;
  onPick: (value: string | null) => void;
  render?: (option: string) => ReactNode;
}) {
  return (
    <div className="chip-row" role="radiogroup">
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        className={value === null ? 'chip on' : 'chip'}
        onClick={() => onPick(null)}
      >
        {anyLabel}
      </button>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={value === option ? 'chip on' : 'chip'}
          onClick={() => onPick(option)}
        >
          {render ? render(option) : option}
        </button>
      ))}
    </div>
  );
}

export default function AlertRules({ session }: { session: Session }) {
  const editable = allows(session, 'alert.manage');
  const toast = useToast();
  const confirm = useConfirm();

  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await listAlertRules();
      setRules(result.rules);
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Cerberus cannot load the rules.');
      setRules([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function patchCondition(change: Partial<AlertCondition>) {
    setDraft((prev) => (prev ? { ...prev, condition: { ...prev.condition, ...change } } : prev));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;

    setBusy(true);
    setError(null);
    setNote(null);

    const body = {
      name: draft.name,
      description: draft.description,
      enabled: draft.enabled,
      severity: draft.severity,
      condition: draft.condition,
      labels: parseLabels(draft.labelText),
    };

    try {
      if (draft.id) await updateAlertRule(draft.id, body);
      else await createAlertRule(body);

      await load();
      setDraft(null);
      setNote(draft.id ? 'The rule is saved.' : 'The rule is created.');
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(rule: AlertRule) {
    setError(null);
    try {
      await updateAlertRule(rule.id, { enabled: !rule.enabled });
      setRules((prev) =>
        prev?.map((row) => (row.id === rule.id ? { ...row, enabled: !row.enabled } : row)) ?? prev,
      );
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.');
    }
  }

  async function drop(rule: AlertRule) {
    setError(null);
    try {
      await deleteAlertRule(rule.id);
      setRules((prev) => prev?.filter((row) => row.id !== rule.id) ?? prev);
      toast.done(`${rule.name} is deleted.`);
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.');
    }
  }

  return (
    <div className="page profile-page">
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

      {draft ? (
        <form className="panel" onSubmit={save}>
          <div className="panel-head">
            <h3>{draft.id ? 'Edit the rule' : 'New rule'}</h3>
            <p>Read it from the top. It says what fires, and how loudly.</p>
          </div>

          <div className="stack-fields">
            <label className="field plain">
              <span>Name</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Critical findings in production"
              />
            </label>

            <label className="field plain">
              <span>Description</span>
              <input
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder="Optional. Why this rule exists."
              />
            </label>
          </div>

          <div className="rule-sentence">
            <div className="rule-clause">
              <span className="rule-word">When</span>
              <select
                value={draft.condition.trigger}
                onChange={(event) => patchCondition({ trigger: event.target.value as AlertTrigger })}
              >
                {TRIGGERS.map((trigger) => (
                  <option key={trigger} value={trigger}>
                    {TRIGGER_LABEL[trigger]}
                  </option>
                ))}
              </select>
              <small className="field-hint">{TRIGGER_BLURB[draft.condition.trigger]}</small>
            </div>

            <div className="rule-clause">
              <span className="rule-word">And the severity is</span>
              <OneOf
                options={SEVERITY_ORDER}
                value={draft.condition.severity}
                anyLabel="Any severity"
                onPick={(value) => patchCondition({ severity: value as Severity | null })}
                render={(option) => (
                  <>
                    <i className={`sev-dot sev-${option}`} aria-hidden="true" />
                    {SEVERITY_LABEL[option as Severity]}
                  </>
                )}
              />
            </div>

            <div className="rule-clause">
              <span className="rule-word">And the source is</span>
              <OneOf
                options={SOURCES}
                value={draft.condition.source}
                anyLabel="Any source"
                onPick={(value) => patchCondition({ source: value })}
              />
            </div>

            <div className="rule-clause">
              <span className="rule-word">And the asset is</span>
              <OneOf
                options={ASSET_KINDS}
                value={draft.condition.assetKind}
                anyLabel="Any asset"
                onPick={(value) => patchCondition({ assetKind: value })}
              />
            </div>

            <div className="rule-clause">
              <span className="rule-word">And it happens</span>
              <div className="inline-fields">
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={draft.condition.count}
                  onChange={(event) => patchCondition({ count: Math.max(1, Number(event.target.value)) })}
                />
                <span>times within</span>
                <input
                  type="number"
                  min={0}
                  max={10080}
                  value={draft.condition.windowMinutes}
                  onChange={(event) => patchCondition({ windowMinutes: Math.max(0, Number(event.target.value)) })}
                />
                <span>minutes</span>
              </div>
              <small className="field-hint">One time with a zero window fires on the first event.</small>
            </div>

            <div className="rule-clause">
              <span className="rule-word">Then fire at severity</span>
              <div className="chip-row">
                {SEVERITY_ORDER.map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={draft.severity === level ? 'chip on' : 'chip'}
                    aria-pressed={draft.severity === level}
                    onClick={() => setDraft({ ...draft, severity: level })}
                  >
                    <i className={`sev-dot sev-${level}`} aria-hidden="true" />
                    {SEVERITY_LABEL[level]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="field plain">
            <span>Labels</span>
            <textarea
              rows={3}
              value={draft.labelText}
              onChange={(event) => setDraft({ ...draft, labelText: event.target.value })}
              placeholder={'severity=critical\nteam=platform'}
            />
            <small className="field-hint">
              One key=value per line. The notification policy routes on these, so a rule never names a contact point.
            </small>
          </label>

          <label className="switch-row">
            <input
              type="checkbox"
              role="switch"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />
            <span className="switch-track" aria-hidden="true">
              <span className="switch-thumb" />
            </span>
            <span className="switch-text">
              <strong>Enabled</strong>
              <small>A rule that is off keeps its settings and fires nothing.</small>
            </span>
          </label>

          <div className="panel-actions">
            <button type="button" className="ghost-button" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={busy || !draft.name.trim()}>
              {busy ? 'Saving' : draft.id ? 'Save rule' : 'Create rule'}
            </button>
          </div>
        </form>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <h3>Alert rules</h3>
            <p>Each one decides what is worth waking somebody about.</p>
          </div>

          {rules === null ? (
            <p className="field-hint">Loading the rules.</p>
          ) : rules.length === 0 ? (
            <p className="field-hint">No rules yet. The first one takes about a minute.</p>
          ) : (
            <ul className="rule-list">
              {rules.map((rule) => (
                <li key={rule.id}>
                  <span className="rule-main">
                    <strong>
                      <i className={`sev-dot sev-${rule.severity}`} aria-hidden="true" />
                      {rule.name}
                      <span className={rule.enabled ? 'state-tag state-healthy' : 'state-tag'}>
                        {rule.enabled ? 'On' : 'Off'}
                      </span>
                    </strong>
                    <small>{describe(rule.condition)}</small>
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

                  {editable && (
                    <span className="rule-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => toggleEnabled(rule)}
                        aria-label={rule.enabled ? `Turn off ${rule.name}` : `Turn on ${rule.name}`}
                      >
                        {rule.enabled ? 'Turn off' : 'Turn on'}
                      </button>
                      <button
                        type="button"
                        className="ghost-icon-button"
                        aria-label={`Edit ${rule.name}`}
                        onClick={() => setDraft(toDraft(rule))}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="ghost-icon-button"
                        aria-label={`Delete ${rule.name}`}
                        onClick={() =>
                          confirm.ask({
                            title: `Delete ${rule.name}?`,
                            body: 'This rule stops judging findings, and it cannot be brought back. Any alert it already raised stays.',
                            action: 'Delete rule',
                            destructive: true,
                            onConfirm: () => drop(rule),
                          })
                        }
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {editable && (
            <div className="panel-actions">
              <button type="button" className="primary-button" onClick={() => setDraft(blankDraft())}>
                <Plus size={16} aria-hidden="true" />
                New rule
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

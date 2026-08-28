import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Check, KeyRound, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import {
  ApiFailure,
  createContactPoint,
  deleteContactPoint,
  listContactPoints,
  updateContactPoint,
} from '../../app/api';
import { allows, type Session } from '../../app/session';
import { useToast } from '../../app/toast';
import { useConfirm } from '../../app/confirm';
import {
  INTEGRATION_BLURB,
  INTEGRATION_FIELDS,
  INTEGRATION_LABEL,
  type ContactPoint,
  type IntegrationType,
} from '../../../shared/alerting';

/**
 * Contact points.
 *
 * A secret never comes back from the API. An empty secret box means "keep what
 * is stored", so editing a name cannot wipe a webhook URL by accident.
 */

const TYPES = Object.keys(INTEGRATION_LABEL) as IntegrationType[];

type DraftIntegration = {
  type: IntegrationType;
  values: Record<string, string>;
  /** Keys the API says already hold a secret. */
  stored: string[];
};

type Draft = {
  id: string | null;
  name: string;
  integrations: DraftIntegration[];
};

function blankIntegration(type: IntegrationType): DraftIntegration {
  return { type, values: {}, stored: [] };
}

function toDraft(point: ContactPoint): Draft {
  return {
    id: point.id,
    name: point.name,
    integrations: point.integrations.map((integration) => {
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(integration.settings)) {
        values[key] = Array.isArray(value) ? value.join(', ') : value;
      }
      // A stored secret arrives masked. Clear it so the box reads as empty and
      // leaving it alone keeps the stored value.
      for (const key of integration.secrets) values[key] = '';
      return { type: integration.type, values, stored: integration.secrets };
    }),
  };
}

/** Turns the form values into what the API expects. */
function toSettings(integration: DraftIntegration): Record<string, string | string[]> {
  const settings: Record<string, string | string[]> = {};

  for (const field of INTEGRATION_FIELDS[integration.type]) {
    const raw = integration.values[field.key] ?? '';
    if (field.list) {
      settings[field.key] = raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (raw.trim()) {
      settings[field.key] = raw.trim();
    }
  }

  return settings;
}

/** One line describing what a contact point actually reaches. */
function summarise(point: ContactPoint): string {
  return point.integrations
    .map((integration) => {
      const label = INTEGRATION_LABEL[integration.type];
      const first = INTEGRATION_FIELDS[integration.type][0];
      const value = first ? integration.settings[first.key] : undefined;

      if (Array.isArray(value) && value.length > 0) return `${label}: ${value.join(', ')}`;
      if (typeof value === 'string' && value) return `${label}: ${value}`;
      return label;
    })
    .join(' · ');
}

export default function ContactPoints({ session }: { session: Session }) {
  const editable = allows(session, 'alert.manage');
  const toast = useToast();
  const confirm = useConfirm();

  const [points, setPoints] = useState<ContactPoint[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await listContactPoints();
      setPoints(result.contactPoints);
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Cerberus cannot load the contact points.');
      setPoints([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;

    setBusy(true);
    setError(null);
    setNote(null);

    const body = {
      name: draft.name,
      integrations: draft.integrations.map((integration) => ({
        type: integration.type,
        settings: toSettings(integration),
      })),
    };

    try {
      if (draft.id) await updateContactPoint(draft.id, body);
      else await createContactPoint(body);

      await load();
      setDraft(null);
      setNote(draft.id ? 'The contact point is saved.' : 'The contact point is created.');
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function drop(point: ContactPoint) {
    setError(null);
    try {
      await deleteContactPoint(point.id);
      setPoints((prev) => prev?.filter((row) => row.id !== point.id) ?? prev);
      toast.done(`${point.name} is deleted.`);
    } catch (caught) {
      const why = caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.';
      toast.fail(why);
      setError(why);
    }
  }

  /** Asks first. Deleting a contact point loses its stored webhook secrets. */
  function askDrop(point: ContactPoint) {
    confirm.ask({
      title: `Delete ${point.name}?`,
      body: point.unused
        ? 'Nothing routes to this contact point. Deleting it loses the addresses and any stored webhook secret.'
        : 'This contact point still receives alerts. Deleting it loses the addresses and any stored webhook secret.',
      action: 'Delete contact point',
      destructive: true,
      onConfirm: () => drop(point),
    });
  }

  function patchValue(index: number, key: string, value: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const integrations = [...prev.integrations];
      const current = integrations[index];
      if (!current) return prev;
      integrations[index] = { ...current, values: { ...current.values, [key]: value } };
      return { ...prev, integrations };
    });
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
            <h3>{draft.id ? 'Edit the contact point' : 'New contact point'}</h3>
            <p>One name, and every way you want to reach somebody.</p>
          </div>

          <label className="field plain">
            <span>Name</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="Security on call"
            />
          </label>

          <ul className="integration-list">
            {draft.integrations.map((integration, index) => (
              <li key={index}>
                <div className="integration-head">
                  <strong>{INTEGRATION_LABEL[integration.type]}</strong>
                  <small>{INTEGRATION_BLURB[integration.type]}</small>
                  <button
                    type="button"
                    className="ghost-icon-button"
                    aria-label={`Remove the ${INTEGRATION_LABEL[integration.type]} step`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        integrations: draft.integrations.filter((_, at) => at !== index),
                      })
                    }
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>

                <div className="stack-fields">
                  {INTEGRATION_FIELDS[integration.type].map((field) => {
                    const held = integration.stored.includes(field.key);
                    return (
                      <label className="field plain" key={field.key}>
                        <span>
                          {field.label}
                          {field.secret && (
                            <span className="secret-tag">
                              <KeyRound size={11} aria-hidden="true" />
                              Secret
                            </span>
                          )}
                        </span>
                        <input
                          type={field.secret ? 'password' : 'text'}
                          value={integration.values[field.key] ?? ''}
                          placeholder={held ? 'Stored. Leave empty to keep it.' : field.placeholder}
                          onChange={(event) => patchValue(index, field.key, event.target.value)}
                        />
                        {field.list && <small className="field-hint">Separate several with a comma.</small>}
                      </label>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>

          <div className="add-integration">
            <span className="field-hint">Add a way to reach somebody:</span>
            <div className="chip-row">
              {TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="chip"
                  onClick={() =>
                    setDraft({ ...draft, integrations: [...draft.integrations, blankIntegration(type)] })
                  }
                >
                  <Plus size={12} aria-hidden="true" />
                  {INTEGRATION_LABEL[type]}
                </button>
              ))}
            </div>
          </div>

          <div className="panel-actions">
            <button type="button" className="ghost-button" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={busy || !draft.name.trim() || draft.integrations.length === 0}
            >
              {busy ? 'Saving' : draft.id ? 'Save contact point' : 'Create contact point'}
            </button>
          </div>
        </form>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <h3>Contact points</h3>
            <p>How a person hears about an alert.</p>
          </div>

          {points === null ? (
            <p className="field-hint">Loading the contact points.</p>
          ) : points.length === 0 ? (
            <p className="field-hint">Nothing here yet. A contact point is where an alert ends up.</p>
          ) : (
            <ul className="rule-list">
              {points.map((point) => (
                <li key={point.id}>
                  <span className="rule-main">
                    <strong>
                      {point.name}
                      {point.unused && <span className="state-tag state-degraded">Unused</span>}
                    </strong>
                    <small>{summarise(point)}</small>
                  </span>

                  {editable && (
                    <span className="rule-actions">
                      <button
                        type="button"
                        className="ghost-icon-button"
                        aria-label={`Edit ${point.name}`}
                        onClick={() => setDraft(toDraft(point))}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="ghost-icon-button"
                        aria-label={`Delete ${point.name}`}
                        onClick={() => askDrop(point)}
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
              <button
                type="button"
                className="primary-button"
                onClick={() => setDraft({ id: null, name: '', integrations: [blankIntegration('email')] })}
              >
                <Plus size={16} aria-hidden="true" />
                New contact point
              </button>
            </div>
          )}
        </section>
      )}

      <section className="empty-note">
        <h3>Nothing sends yet</h3>
        <p>
          Cerberus stores these and shows them to the routing, but no message leaves the server. Delivery arrives
          with the evaluator.
        </p>
      </section>
    </div>
  );
}

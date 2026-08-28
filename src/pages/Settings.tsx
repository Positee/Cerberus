import { FormEvent, useState } from 'react';
import { Check, Lock, TriangleAlert } from 'lucide-react';
import { ApiFailure, updateWorkspace } from '../app/api';
import { allows, type Session } from '../app/session';
import { ROLE_LABEL } from '../../shared/permissions';
import { SLUG_PATTERN } from '../../shared/api';
import type { PublicOrganization } from '../../shared/api';

/**
 * Workspace settings.
 *
 * An organization sets a display name and a slug. A personal workspace has
 * only a name, because it has no public address and no hierarchy to shape.
 */

type Props = {
  session: Session;
  onOrganizationChange: (organization: PublicOrganization) => void;
};

export default function Settings({ session, onOrganizationChange }: Props) {
  const workspace = session.organization;
  const organization = workspace.kind === 'organization';
  const editable = allows(session, 'workspace.settings');

  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const slugValid = !organization || SLUG_PATTERN.test(slug);
  const changed = name !== workspace.name || slug !== workspace.slug;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    setDone(false);

    try {
      const next = await updateWorkspace(organization ? { name, slug } : { name });
      onOrganizationChange(next);
      setDone(true);
    } catch (caught) {
      const failure = caught instanceof ApiFailure ? caught : null;
      setError(failure?.message ?? 'Something failed. Try again.');
      setFields(failure?.fields ?? {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page profile-page">
      {!editable && (
        <p className="policy-note" role="status">
          <Lock size={15} aria-hidden="true" />
          You are a {ROLE_LABEL[session.role]} in this workspace, so these settings are read only.
        </p>
      )}

      <form className="panel" onSubmit={save}>
        <div className="panel-head">
          <h3>{organization ? 'Organization' : 'Workspace'}</h3>
          <p>
            {organization
              ? 'The name people see, and the address the workspace answers to.'
              : 'This workspace belongs to you alone. Anyone you add works at your level.'}
          </p>
        </div>

        <div className="stack-fields">
          <label className="field plain">
            <span>Display name</span>
            <input
              value={name}
              disabled={!editable || busy}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Security"
            />
            {fields.name && (
              <small className="field-error" role="alert">
                {fields.name}
              </small>
            )}
          </label>

          {organization && (
            <label className="field plain">
              <span>Organization slug</span>
              <input
                value={slug}
                disabled={!editable || busy}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
                placeholder="acme-security"
                spellCheck={false}
              />
              <small className="field-hint">
                cerberus.app/<strong>{slug || 'your-slug'}</strong>
              </small>
              {slug && !slugValid && (
                <small className="field-error" role="alert">
                  Use lower case letters, numbers, and single hyphens.
                </small>
              )}
              {fields.slug && (
                <small className="field-error" role="alert">
                  {fields.slug}
                </small>
              )}
            </label>
          )}
        </div>

        {error && (
          <p className="auth-error" role="alert">
            <TriangleAlert size={15} aria-hidden="true" />
            {error}
          </p>
        )}

        {done && !error && (
          <p className="save-note" role="status">
            <Check size={15} aria-hidden="true" />
            Your workspace is saved.
          </p>
        )}

        {editable && (
          <div className="panel-actions">
            <button className="primary-button" type="submit" disabled={busy || !changed || !slugValid || !name.trim()}>
              {busy ? 'Saving' : 'Save workspace'}
            </button>
          </div>
        )}
      </form>

      <section className="panel">
        <div className="panel-head">
          <h3>Your role</h3>
          <p>What you may do inside this workspace.</p>
        </div>
        <p className="role-line">
          <span className={`role-chip role-${session.role}`}>{ROLE_LABEL[session.role]}</span>
          {organization
            ? 'Roles and the member policy live under Workspace.'
            : 'A personal workspace is flat, so everybody works at the same level.'}
        </p>
      </section>
    </div>
  );
}

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, Mail, Plus, TriangleAlert, X } from 'lucide-react';
import {
  ApiFailure,
  createInvitation,
  listInvitations,
  revokeInvitation,
} from '../app/api';
import { allows, type Session } from '../app/session';
import { useToast } from '../app/toast';
import { useConfirm } from '../app/confirm';
import { ROLE_BLURB, ROLE_LABEL } from '../../shared/permissions';
import { EMAIL_PATTERN } from '../../shared/password';
import { INVITATION_DAYS, type MemberRole, type WorkspaceInvitation } from '../../shared/api';

/**
 * Invites.
 *
 * Bringing somebody in is one job, so it gets one screen. Workspace shows who
 * is already here and what they may do. This shows who is on the way.
 *
 * A link appears exactly once, because the database keeps only its hash. That
 * is the same rule sessions follow, and it is why the panel refuses to let the
 * link scroll away without being copied.
 */

/** Roles an invitation may hand out. Nobody invites a second owner. */
const ROLES: MemberRole[] = ['admin', 'member', 'viewer'];

function daysLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';

  const days = Math.floor(ms / 86400000);
  if (days >= 1) return `${days} ${days === 1 ? 'day' : 'days'} left`;

  const hours = Math.max(1, Math.floor(ms / 3600000));
  return `${hours} ${hours === 1 ? 'hour' : 'hours'} left`;
}

/** The one showing of a fresh link. It cannot be recovered after this. */
function FreshLink({ link, email, onDone }: { link: string; email: string; onDone: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.done('The link is copied.', `Send it to ${email}.`);
    } catch {
      // Clipboard access can be refused. The field is selectable either way.
      toast.warn('Cerberus cannot reach the clipboard.', 'Select the link and copy it by hand.');
    }
  }

  return (
    <section className="panel invite-fresh">
      <div className="panel-head">
        <h3>
          <Link2 size={16} aria-hidden="true" />
          The link for {email}
        </h3>
        <p>
          Copy it now. Cerberus cannot show this link again. It stops working in {INVITATION_DAYS} days.
        </p>
      </div>

      <div className="invite-link-row">
        <input readOnly value={link} onFocus={(event) => event.target.select()} aria-label="Invitation link" />
        <button type="button" className="primary-button" onClick={() => void copy()}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>

      <div className="form-actions">
        <button type="button" className="ghost-button" onClick={onDone}>
          {copied ? 'Done' : 'Dismiss without copying'}
        </button>
      </div>
    </section>
  );
}

export default function Invites({ session }: { session: Session }) {
  const canInvite = allows(session, 'member.invite');
  const toast = useToast();
  const confirm = useConfirm();

  const [rows, setRows] = useState<WorkspaceInvitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [fresh, setFresh] = useState<{ link: string; email: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await listInvitations();
      setRows(result.invitations);
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Cerberus cannot load the invitations.');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const emailValid = EMAIL_PATTERN.test(email.trim().toLowerCase());

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!emailValid) return;

    setBusy(true);
    setError(null);

    try {
      const result = await createInvitation({ email: email.trim().toLowerCase(), role });
      setFresh({ link: result.link, email: result.invitation.email });
      setEmail('');
      setRole('member');
      await load();
      toast.done('The invitation is ready.', 'Copy the link and send it.');
    } catch (caught) {
      const why = caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.';
      setError(why);
      toast.fail(why);
    } finally {
      setBusy(false);
    }
  }

  async function drop(row: WorkspaceInvitation) {
    try {
      await revokeInvitation(row.id);
      setRows((prev) => prev?.filter((item) => item.id !== row.id) ?? prev);
      toast.done(`The invitation for ${row.email} is revoked.`);
    } catch (caught) {
      toast.fail(caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.');
    }
  }

  function revoke(row: WorkspaceInvitation) {
    confirm.ask({
      title: `Revoke the invitation for ${row.email}?`,
      body: 'The link stops working straight away. You can send a new one whenever you like.',
      action: 'Revoke invitation',
      destructive: true,
      onConfirm: () => drop(row),
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

      {fresh && <FreshLink link={fresh.link} email={fresh.email} onDone={() => setFresh(null)} />}

      {canInvite ? (
        <form className="panel" onSubmit={send}>
          <div className="panel-head">
            <h3>Invite somebody</h3>
            <p>
              Cerberus makes a link. Send it however you like. Nothing is emailed yet, so the link is the whole
              invitation.
            </p>
          </div>

          <div className="stack-fields">
            <label className="field plain">
              <span>Email address</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="teammate@acme.com"
                autoComplete="off"
              />
              <small className="field-hint">
                {email && !emailValid
                  ? 'That does not look like an email address.'
                  : 'The link only works for this address.'}
              </small>
            </label>

            <fieldset className="role-choice">
              <legend>Role</legend>
              {ROLES.map((option) => (
                <label key={option} className={role === option ? 'role-option on' : 'role-option'}>
                  <input
                    type="radio"
                    name="invite-role"
                    value={option}
                    checked={role === option}
                    onChange={() => setRole(option)}
                  />
                  <span>
                    <strong>{ROLE_LABEL[option]}</strong>
                    <small>{ROLE_BLURB[option]}</small>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="form-actions">
              <button type="submit" className="primary-button" disabled={busy || !emailValid}>
                <Plus size={15} aria-hidden="true" />
                {busy ? 'Making the link' : 'Create invitation'}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <section className="empty-note">
          <h3>You cannot invite people</h3>
          <p>An admin can change that in Workspace settings, under Membership.</p>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3>On the way</h3>
          <p>Invitations nobody has accepted yet.</p>
        </div>

        {rows === null ? (
          <>
            <span className="skeleton skeleton-title" />
            <span className="skeleton skeleton-line" />
          </>
        ) : rows.length === 0 ? (
          <p className="field-hint">Nobody is waiting. Anyone you invite shows here until they join.</p>
        ) : (
          <ul className="invite-list">
            {rows.map((row) => {
              const expired = new Date(row.expiresAt).getTime() <= Date.now();
              return (
                <li key={row.id} className={expired ? 'invite-row expired' : 'invite-row'}>
                  <span className="invite-who">
                    <Mail size={15} aria-hidden="true" />
                    <strong>{row.email}</strong>
                    <small>
                      {ROLE_LABEL[row.role]}
                      {row.invitedBy ? ` · invited by ${row.invitedBy}` : ''}
                    </small>
                  </span>

                  <span className={expired ? 'state-tag state-offline' : 'state-tag'}>{daysLeft(row.expiresAt)}</span>

                  {canInvite && (
                    <button type="button" className="ghost-button" onClick={() => revoke(row)}>
                      <X size={14} aria-hidden="true" />
                      Revoke
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

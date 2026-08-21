import { useCallback, useEffect, useState } from 'react';
import { Check, Lock, TriangleAlert, UserMinus, UserPlus } from 'lucide-react';
import {
  ApiFailure,
  removeMember,
  updateMember,
  updateWorkspace,
  workspaceMembers,
} from '../app/api';
import { allows, type Session } from '../app/session';
import { useToast } from '../app/toast';
import { useConfirm } from '../app/confirm';
import { ASSIGNABLE_ROLES, ROLE_BLURB, ROLE_LABEL } from '../../shared/permissions';
import type { MemberRole, PublicOrganization, WorkspaceMember, WorkspacePolicy } from '../../shared/api';

/**
 * The people in the workspace, and what a plain member may do.
 *
 * An organization gets roles and policy switches. A personal workspace is
 * flat, so it lists people and says so plainly.
 */

type Props = {
  session: Session;
  onOrganizationChange: (organization: PublicOrganization) => void;
};

type Switch = {
  key: keyof WorkspacePolicy;
  label: string;
  blurb: string;
};

const SWITCHES: Switch[] = [
  {
    key: 'membersCanInvite',
    label: 'Let members invite others',
    blurb: 'A member can bring somebody new into the workspace.',
  },
  {
    key: 'membersCanCreateProjects',
    label: 'Let members create projects',
    blurb: 'A member can group assets into a new project.',
  },
  {
    key: 'membersCanManageAlerts',
    label: 'Let members create and edit alerts',
    blurb: 'A member can change what wakes somebody up.',
  },
];

export default function Workspace({ session, onOrganizationChange }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const workspace = session.organization;
  const organization = workspace.kind === 'organization';
  const canManage = allows(session, 'member.manage');
  const canSettings = allows(session, 'workspace.settings');
  const canInvite = allows(session, 'member.invite');

  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState<keyof WorkspacePolicy | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await workspaceMembers();
      setMembers(result.members);
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Cerberus cannot load the members.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function flip(key: keyof WorkspacePolicy, value: boolean) {
    setSavingPolicy(key);
    setError(null);
    setNote(null);

    try {
      onOrganizationChange(await updateWorkspace({ policy: { [key]: value } }));
      setNote('The policy is saved.');
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.');
    } finally {
      setSavingPolicy(null);
    }
  }

  async function changeRole(member: WorkspaceMember, role: MemberRole) {
    setError(null);
    setNote(null);

    try {
      await updateMember(member.membershipId, { role });
      setMembers((prev) =>
        prev?.map((row) => (row.membershipId === member.membershipId ? { ...row, role } : row)) ?? prev,
      );
      setNote(`${member.fullName} is now a ${ROLE_LABEL[role]}.`);
    } catch (caught) {
      setError(caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.');
    }
  }

  /** Asks first. Removing somebody revokes their access at once. */
  function askDrop(member: WorkspaceMember) {
    confirm.ask({
      title: `Remove ${member.fullName}?`,
      body: `${member.fullName} loses access to this workspace immediately. Anything they created stays. You can invite them again later.`,
      action: 'Remove member',
      destructive: true,
      onConfirm: () => drop(member),
    });
  }

  async function drop(member: WorkspaceMember) {
    setError(null);
    setNote(null);

    try {
      await removeMember(member.membershipId);
      setMembers((prev) => prev?.filter((row) => row.membershipId !== member.membershipId) ?? prev);
      toast.done(`${member.fullName} is removed.`);
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

      <section className="panel">
        <div className="panel-head">
          <h3>Membership</h3>
          <p>
            {organization
              ? 'Everybody in this workspace, and the role each one holds.'
              : 'Everybody in this workspace. A personal workspace is flat, so everybody works at your level.'}
          </p>
        </div>

        {members === null ? (
          <p className="field-hint">Loading the members.</p>
        ) : (
          <ul className="member-list">
            {members.map((member) => {
              const self = member.userId === session.user.id;
              const locked = member.role === 'owner';

              return (
                <li key={member.membershipId}>
                  <span className="member-mark" aria-hidden="true">
                    {member.fullName
                      .trim()
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((word) => word[0] ?? '')
                      .join('')
                      .toUpperCase()}
                  </span>

                  <span className="member-name">
                    <strong>
                      {member.fullName}
                      {self && <span className="you-chip">You</span>}
                    </strong>
                    <small>{member.email}</small>
                  </span>

                  {organization && canManage && !locked ? (
                    <label className="member-role">
                      <span className="visually-hidden">Role for {member.fullName}</span>
                      <select
                        value={member.role}
                        onChange={(event) => changeRole(member, event.target.value as MemberRole)}
                      >
                        {ASSIGNABLE_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className={`role-chip role-${member.role}`}>{ROLE_LABEL[member.role]}</span>
                  )}

                  {canManage && !locked && !self && (
                    <button
                      type="button"
                      className="ghost-icon-button"
                      aria-label={`Remove ${member.fullName}`}
                      title={`Remove ${member.fullName}`}
                      onClick={() => askDrop(member)}
                    >
                      <UserMinus size={16} aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="panel-actions">
          <button type="button" className="primary-button" disabled title="Invites arrive in the next pass.">
            <UserPlus size={16} aria-hidden="true" />
            {canInvite ? 'Invite people' : 'Invites need a higher role'}
          </button>
        </div>
        <p className="field-hint">Invitations are the next piece of work. The list above is live.</p>
      </section>

      {organization && (
        <section className="panel">
          <div className="panel-head">
            <h3>What members may do</h3>
            <p>An owner and an admin always may. A viewer never may. These decide the middle.</p>
          </div>

          {!canSettings && (
            <p className="policy-note">
              <Lock size={15} aria-hidden="true" />
              Your role does not allow changing the policy.
            </p>
          )}

          <ul className="switch-list">
            {SWITCHES.map((option) => {
              const on = workspace.policy[option.key];
              return (
                <li key={option.key}>
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={on}
                      disabled={!canSettings || savingPolicy !== null}
                      onChange={(event) => flip(option.key, event.target.checked)}
                    />
                    <span className="switch-track" aria-hidden="true">
                      <span className="switch-thumb" />
                    </span>
                    <span className="switch-text">
                      <strong>{option.label}</strong>
                      <small>{option.blurb}</small>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3>What each role means</h3>
          <p>{organization ? 'Cerberus checks this on every request.' : 'A personal workspace uses the first and the third.'}</p>
        </div>
        <ul className="role-legend">
          {(['owner', 'admin', 'member', 'viewer'] as MemberRole[])
            .filter((role) => organization || role === 'owner' || role === 'member')
            .map((role) => (
              <li key={role}>
                <span className={`role-chip role-${role}`}>{ROLE_LABEL[role]}</span>
                <span>{ROLE_BLURB[role]}</span>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

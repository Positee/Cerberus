import { organizations, users } from '../db/schema.js';
import type { PublicOrganization, PublicUser } from '../../../shared/api.js';
import { FLAT_POLICY } from '../../../shared/permissions.js';

/**
 * The shapes the API sends to the browser.
 *
 * Every query names its columns here instead of selecting the whole row. The
 * avatar bytes and the password hash then stay in the database unless an
 * endpoint asks for them by name. A session read must never carry an image.
 */

export const publicUserColumns = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  githubHandle: users.githubHandle,
  primaryStack: users.primaryStack,
  avatarUpdatedAt: users.avatarUpdatedAt,
};

export const publicOrganizationColumns = {
  id: organizations.id,
  name: organizations.name,
  slug: organizations.slug,
  kind: organizations.kind,
  teamSize: organizations.teamSize,
  useCase: organizations.useCase,
  membersCanInvite: organizations.membersCanInvite,
  membersCanCreateProjects: organizations.membersCanCreateProjects,
  membersCanManageAlerts: organizations.membersCanManageAlerts,
};

type UserRow = {
  id: string;
  email: string;
  fullName: string;
  githubHandle: string | null;
  primaryStack: string | null;
  avatarUpdatedAt: Date | null;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  kind: 'personal' | 'organization';
  teamSize: string | null;
  useCase: string | null;
  membersCanInvite: boolean;
  membersCanCreateProjects: boolean;
  membersCanManageAlerts: boolean;
};

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    githubHandle: row.githubHandle,
    primaryStack: row.primaryStack,
    avatarUpdatedAt: row.avatarUpdatedAt?.toISOString() ?? null,
  };
}

export function toPublicOrganization(row: OrganizationRow): PublicOrganization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    teamSize: row.teamSize,
    useCase: row.useCase,
    // A personal workspace is flat, so it reports every switch as on and the
    // permission rule never has to know which kind it is looking at.
    policy:
      row.kind === 'personal'
        ? FLAT_POLICY
        : {
            membersCanInvite: row.membersCanInvite,
            membersCanCreateProjects: row.membersCanCreateProjects,
            membersCanManageAlerts: row.membersCanManageAlerts,
          },
  };
}

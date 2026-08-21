/**
 * The contract between the browser and the API.
 *
 * The React pages and the Fastify routes both import these types. A change
 * here breaks the build on whichever side did not follow.
 */

export type AccountType = 'personal' | 'organization';
export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer';

/**
 * What a plain member may do.
 *
 * An owner and an admin always may. A viewer never may. These switches decide
 * the middle, and only an organization uses them. A personal workspace is
 * flat, so every switch reads as on.
 */
export type WorkspacePolicy = {
  membersCanInvite: boolean;
  membersCanCreateProjects: boolean;
  membersCanManageAlerts: boolean;
};

export type PublicUser = {
  id: string;
  email: string;
  fullName: string;
  githubHandle: string | null;
  primaryStack: string | null;
  /**
   * ISO time of the last picture write, or null when there is no picture.
   * The browser puts it in the image URL, so a new picture beats the cache.
   */
  avatarUpdatedAt: string | null;
};

export type PublicOrganization = {
  id: string;
  name: string;
  slug: string;
  kind: AccountType;
  teamSize: string | null;
  useCase: string | null;
  policy: WorkspacePolicy;
};

/** One row of the membership list. */
export type WorkspaceMember = {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  role: MemberRole;
  jobTitle: string | null;
  avatarUpdatedAt: string | null;
  joinedAt: string;
};

export type UpdateWorkspaceRequest = {
  name?: string;
  slug?: string;
  policy?: Partial<WorkspacePolicy>;
};

export type UpdateMemberRequest = {
  role: MemberRole;
};

/** A pending invitation, as the workspace sees it. */
export type WorkspaceInvitation = {
  id: string;
  email: string;
  role: MemberRole;
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
};

export type CreateInvitationRequest = {
  email: string;
  role: MemberRole;
};

/**
 * The reply to a new invitation.
 *
 * The link appears once. The database keeps only the hash of its token, so
 * Cerberus cannot show it again.
 */
export type CreateInvitationResponse = {
  invitation: WorkspaceInvitation;
  link: string;
};

/** What somebody holding a link sees before they accept it. */
export type InvitationPreview = {
  workspaceName: string;
  workspaceKind: AccountType;
  role: MemberRole;
  email: string;
  invitedBy: string | null;
  expiresAt: string;
};

/** How long a link stays good. */
export const INVITATION_DAYS = 7;

/** The slug rule. Both the form and the API read it from here. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 48;

export type SessionPayload = {
  user: PublicUser;
  organization: PublicOrganization;
  role: MemberRole;
};

export type SignupRequest = {
  accountType: AccountType;
  fullName: string;
  email: string;
  password: string;
  /** Personal accounts only. */
  githubHandle?: string;
  primaryStack?: string;
  /** Organization accounts only. */
  organizationName?: string;
  teamSize?: string;
  jobTitle?: string;
  useCase?: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

/**
 * The profile requests.
 *
 * Changing an email address or deleting an account is a security event, so
 * both carry the current password. A borrowed laptop is not enough.
 */

export type UpdateProfileRequest = {
  fullName: string;
  githubHandle?: string;
  primaryStack?: string;
};

export type UpdateEmailRequest = {
  email: string;
  currentPassword: string;
};

export type UpdatePasswordRequest = {
  currentPassword: string;
  newPassword: string;
};

export type DeleteAccountRequest = {
  currentPassword: string;
};

/**
 * The picture rules. The browser crops to a square on a canvas and sends the
 * result, so the API stores small bytes and needs no image library.
 */
export const AVATAR_SIZE = 400;
export const AVATAR_MAX_BYTES = 512 * 1024;
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];

/** Every failure returns this shape, so the client has one branch to write. */
export type ApiError = {
  error: {
    code:
      | 'invalid_request'
      | 'email_taken'
      | 'invalid_credentials'
      | 'unauthorized'
      | 'not_found'
      | 'server_error';
    message: string;
    /** Field name to message, when the failure is per field. */
    fields?: Record<string, string>;
  };
};

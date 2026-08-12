/**
 * The contract between the browser and the API.
 *
 * The React pages and the Fastify routes both import these types. A change
 * here breaks the build on whichever side did not follow.
 */

export type AccountType = 'personal' | 'organization';
export type MemberRole = 'owner' | 'admin' | 'member';

export type PublicUser = {
  id: string;
  email: string;
  fullName: string;
  githubHandle: string | null;
  primaryStack: string | null;
};

export type PublicOrganization = {
  id: string;
  name: string;
  slug: string;
  kind: AccountType;
  teamSize: string | null;
  useCase: string | null;
};

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

/** Every failure returns this shape, so the client has one branch to write. */
export type ApiError = {
  error: {
    code: 'invalid_request' | 'email_taken' | 'invalid_credentials' | 'unauthorized' | 'server_error';
    message: string;
    /** Field name to message, when the failure is per field. */
    fields?: Record<string, string>;
  };
};

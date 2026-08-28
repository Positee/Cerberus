import { useCallback, useEffect, useState } from 'react';
import type { PublicOrganization, PublicUser, SessionPayload } from '../../shared/api';
import { can, type Permission } from '../../shared/permissions';
import { logout as apiLogout, me } from './api';

/**
 * The signed in session.
 *
 * The API owns the truth. The browser holds a copy for the render, and the
 * HTTP-only cookie does the real work. Nothing about the session lives in
 * localStorage, so a stale copy cannot outlive the cookie.
 */

export type Session = SessionPayload;

export function isOrganization(session: Session | null): boolean {
  return session?.organization.kind === 'organization';
}

/**
 * Two letters for the avatar.
 *
 * An organization shows the company initials. A personal account shows the
 * person's initials. One name gives its first two letters, so the mark never
 * sits as a single thin character.
 */
export function initials(session: Session): string {
  const source =
    session.organization.kind === 'organization' ? session.organization.name : session.user.fullName;
  const words = source.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return session.user.email.slice(0, 1).toUpperCase() || '?';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();

  const first = words[0]?.[0] ?? '';
  const last = words[words.length - 1]?.[0] ?? '';
  return (first + last).toUpperCase();
}

export type SessionHandle = {
  session: Session | null;
  /** False until the first /api/auth/me call settles. */
  ready: boolean;
  signIn: (session: Session) => void;
  /** Puts a fresh user into the held session after a profile change. */
  updateUser: (user: PublicUser) => void;
  /** Puts a fresh workspace in after a settings change. */
  updateOrganization: (organization: PublicOrganization) => void;
  signOut: () => void;
};

export function useSession(): SessionHandle {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;

    me()
      .then((value) => {
        if (alive) setSession(value);
      })
      .catch(() => {
        // The API is down or unreadable. Show the gate. The login attempt
        // then reports the real reason.
        if (alive) setSession(null);
      })
      .finally(() => {
        if (alive) setReady(true);
      });

    return () => {
      alive = false;
    };
  }, []);

  const updateUser = useCallback((user: PublicUser) => {
    setSession((prev) => (prev ? { ...prev, user } : prev));
  }, []);

  const updateOrganization = useCallback((organization: PublicOrganization) => {
    setSession((prev) => (prev ? { ...prev, organization } : prev));
  }, []);

  const signOut = useCallback(() => {
    // Clear the browser first. A failed call must not trap the user inside.
    setSession(null);
    apiLogout().catch((error) => {
      // Never silent. A swallowed failure here once left the session alive on
      // the server while the gate said the user had left.
      console.error('Cerberus could not end the session on the server.', error);
    });
  }, []);

  return { session, ready, signIn: setSession, updateUser, updateOrganization, signOut };
}

/** Asks the permission rule with this session's role, kind, and policy. */
export function allows(session: Session, permission: Permission): boolean {
  return can(permission, {
    role: session.role,
    kind: session.organization.kind,
    policy: session.organization.policy,
  });
}

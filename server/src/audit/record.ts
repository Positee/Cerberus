import type { FastifyRequest } from 'fastify';
import { db } from '../db/client.js';
import { auditEvents } from '../db/schema.js';
import type { AuditAction, AuditResult } from '../../../shared/audit.js';

/**
 * Writes the audit trail.
 *
 * Every action a person takes gets a row, allowed or denied. A denied row is
 * the one an auditor most wants, so a refusal is recorded with the same care as
 * a success.
 */

type Entry = {
  organizationId: string;
  /** Null when nobody is signed in, such as a failed sign in. */
  actorUserId?: string | null;
  /** The email as it reads now. Kept even after the account goes. */
  actor: string;
  action: AuditAction;
  /** What was acted on, in words. Never an opaque id on its own. */
  resource: string;
  result?: AuditResult;
  /** Anything worth keeping that has no column. Never a secret. */
  detail?: Record<string, unknown>;
};

/**
 * The address the request came from.
 *
 * Fastify reads x-forwarded-for because trustProxy is on, so this is the real
 * client address behind a proxy rather than the proxy itself.
 */
function addressOf(request: FastifyRequest): string | null {
  return request.ip || null;
}

/**
 * Records one action.
 *
 * This never throws and never blocks the reply. An audit row is worth having,
 * and it is not worth failing a person's request over. A write that fails is
 * logged, so a broken trail is loud rather than silent.
 *
 * Nothing is awaited on the request path, because each round trip to the
 * database costs real time and doubling that on every write would be felt.
 */
export function record(request: FastifyRequest, entry: Entry): void {
  const row = {
    organizationId: entry.organizationId,
    actorUserId: entry.actorUserId ?? null,
    actorLabel: entry.actor,
    action: entry.action,
    resource: entry.resource,
    ip: addressOf(request),
    userAgent: request.headers['user-agent'] ?? null,
    result: entry.result ?? ('allowed' as const),
    detail: entry.detail ?? null,
  };

  void db
    .insert(auditEvents)
    .values(row)
    .catch((error: unknown) => {
      request.log.error({ err: error, action: entry.action }, 'The audit row was not written.');
    });
}

/**
 * Records a refusal.
 *
 * A person who tried something their role forbids leaves a row. Without it the
 * log only proves what worked, which answers half the question.
 */
export function recordDenied(request: FastifyRequest, entry: Omit<Entry, 'result'>): void {
  record(request, { ...entry, result: 'denied' });
}

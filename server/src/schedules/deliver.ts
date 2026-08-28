import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { notify } from '../notifications/notify.js';
import { contactPoints, notifications } from '../db/schema.js';
import type { IntegrationType } from '../../../shared/alerting.js';

/**
 * Delivery.
 *
 * Two things happen when a schedule runs. A notification is always written, so
 * the bell has it whatever else goes wrong. Then, if the schedule names a
 * contact point, the message goes out to every integration on it.
 *
 * A webhook is a plain HTTP POST, so Slack, Google Chat, and a bare webhook
 * all work today. Email, phone, and text need a provider account, so they
 * report that they were not sent rather than pretending.
 */

/** How long to wait on somebody else's server before giving up. */
const TIMEOUT_MS = 8000;

export type DeliveryResult = { channel: string; sent: boolean; detail: string };

type StoredSecrets = Record<string, Record<string, string>>;

/** Builds the body each service expects. They disagree on the field name. */
function bodyFor(type: IntegrationType, title: string, message: string): string {
  if (type === 'google_chat') return JSON.stringify({ text: `*${title}*\n${message}` });
  if (type === 'slack') return JSON.stringify({ text: `*${title}*\n${message}` });
  return JSON.stringify({ title, message, source: 'cerberus', at: new Date().toISOString() });
}

async function post(url: string, body: string, token?: string): Promise<DeliveryResult['detail']> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) return `refused with ${response.status}`;
    return 'sent';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return 'timed out';
    return error instanceof Error ? error.message.slice(0, 120) : 'failed';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends to every integration on one contact point.
 *
 * One failing channel never stops the others, so a broken webhook cannot
 * silence an email that would have worked.
 */
export async function deliver(
  contactPointId: string,
  title: string,
  message: string,
): Promise<DeliveryResult[]> {
  const [point] = await db
    .select()
    .from(contactPoints)
    .where(eq(contactPoints.id, contactPointId))
    .limit(1);

  if (!point) return [{ channel: 'contact point', sent: false, detail: 'it is gone' }];

  const integrations = (point.integrations ?? []) as Array<{
    type: IntegrationType;
    settings: Record<string, string | string[]>;
  }>;
  const secrets = (point.secrets ?? {}) as StoredSecrets;

  const results: DeliveryResult[] = [];

  for (const [index, integration] of integrations.entries()) {
    const held = secrets[String(index)] ?? {};
    const { type } = integration;

    if (type === 'google_chat' || type === 'slack') {
      const url = held.url;
      if (!url) {
        results.push({ channel: type, sent: false, detail: 'no webhook URL saved' });
        continue;
      }
      const detail = await post(url, bodyFor(type, title, message));
      results.push({ channel: type, sent: detail === 'sent', detail });
      continue;
    }

    if (type === 'webhook') {
      const url = typeof integration.settings.url === 'string' ? integration.settings.url : '';
      if (!url) {
        results.push({ channel: type, sent: false, detail: 'no URL saved' });
        continue;
      }
      const detail = await post(url, bodyFor(type, title, message), held.token);
      results.push({ channel: type, sent: detail === 'sent', detail });
      continue;
    }

    // These need an account somewhere else. Saying so beats pretending.
    results.push({ channel: type, sent: false, detail: 'no provider connected yet' });
  }

  return results;
}

/** Writes the bell entry. This runs whether or not delivery worked. */
/** Turns delivery results into the one line a run row records. */
export function summarise(results: DeliveryResult[]): string | null {
  if (results.length === 0) return null;

  const sent = results.filter((row) => row.sent).map((row) => row.channel);
  const failed = results.filter((row) => !row.sent);

  const parts: string[] = [];
  if (sent.length > 0) parts.push(`sent to ${sent.join(', ')}`);
  for (const row of failed) parts.push(`${row.channel} ${row.detail}`);

  return parts.join('; ');
}

// Kept as a re-export, because the schedule runner already imports it here.
export { notify };

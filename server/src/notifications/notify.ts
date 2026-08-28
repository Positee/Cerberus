import { db } from '../db/client.js';
import { notifications } from '../db/schema.js';

/**
 * Writes to the bell.
 *
 * The bell is not the audit log. The audit log holds everything anybody did,
 * for evidence. The bell holds the few things somebody would want to be told
 * about, and it has to stay short enough to read.
 *
 * Two rules decide whether an action belongs here.
 *
 * Tell somebody what happened to them. A task landing on your plate is worth a
 * line, because you did not do it.
 *
 * Tell the workspace what touched it. Somebody taking a copy of the audit log,
 * or removing a member, is worth everybody seeing, even though the person who
 * did it already knows.
 *
 * A notification never blocks the action it describes. A bell entry is worth
 * having, and it is not worth failing a request over.
 */

export type NotifySource = 'schedule' | 'alert' | 'task' | 'workspace';

export type Notice = {
  organizationId: string;
  /** Null tells the whole workspace. An id tells one person. */
  userId?: string | null;
  source: NotifySource;
  title: string;
  body?: string | null;
  /** Where clicking it goes. */
  href?: string | null;
};

export async function notify(notice: Notice): Promise<void> {
  await db.insert(notifications).values({
    organizationId: notice.organizationId,
    userId: notice.userId ?? null,
    source: notice.source,
    title: notice.title,
    body: notice.body ?? null,
    href: notice.href ?? null,
  });
}

/**
 * The same, for a request path that must not wait.
 *
 * Each round trip to the database costs real time. A bell entry is never worth
 * adding that to a reply, so this fires and forgets, and a failure is logged
 * rather than raised.
 */
export function notifyLater(notice: Notice, log?: { error: (...args: unknown[]) => void }): void {
  void notify(notice).catch((error: unknown) => {
    log?.error({ err: error, title: notice.title }, 'The notification was not written.');
  });
}

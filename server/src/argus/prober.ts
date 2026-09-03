import { and, asc, eq, gte, lte, notInArray, sql as raw } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../db/client.js';
import { monitors, heartbeats } from '../db/schema.js';
import { deliver, notify, summarise } from '../schedules/deliver.js';
import { applyCertificateHealth, inspectCertificateExpiry } from './certificate.js';
import { ConcurrencyGate, InFlightJobs } from './in-flight-jobs.js';

/**
 * The prober.
 *
 * It wakes every 10 seconds, asks which monitors are due, and fires an HTTP
 * probe at each one. The result is written as a heartbeat, and the monitor
 * current status is updated. When the status changes, a bell notification is
 * written and the contact point is alerted.
 *
 * Each monitor has an independent background job. Retries can wait inside that
 * job without delaying the scheduler or another monitor. Only the final result
 * becomes the heartbeat.
 */

const TICK_MS = 10_000;
const MAX_DUE_PER_TICK = 50;
const MAX_CONCURRENT_PROBES = 10;
const monitorJobs = new InFlightJobs<string>();
const probeGate = new ConcurrencyGate(MAX_CONCURRENT_PROBES);

type ProbeResult = {
  status: 'up' | 'down' | 'degraded';
  responseTimeMs: number;
  statusCode: number | null;
  errorMessage: string | null;
  certExpiryDays: number | null;
  retryable: boolean;
};

/**
 * Fires an HTTP request and measures the response.
 *
 * A network error, a timeout, or an unexpected status code counts as a
 * failure. The upside-down mode inverts the result: a 200 is down, a
 * timeout is up.
 */
async function probe(monitor: typeof monitors.$inferSelect): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), monitor.timeoutSeconds * 1000);
  const certificate = monitor.certExpiryCheck
    ? inspectCertificateExpiry(monitor.url, monitor.timeoutSeconds * 1000)
    : Promise.resolve(null);

  const start = Date.now();

  try {
    const headers: Record<string, string> = {
      'user-agent': 'Cerberus-Argus/1.0',
      ...((monitor.headers as Record<string, string>) ?? {}),
    };

    const fetchInit: RequestInit = {
      method: monitor.method,
      headers,
      signal: controller.signal,
      redirect: monitor.maxRedirects > 0 ? 'follow' : 'manual',
    };

    if (monitor.body && ['POST', 'PUT', 'PATCH'].includes(monitor.method)) {
      fetchInit.body = monitor.body;
      if (!headers['content-type']) {
        headers['content-type'] =
          monitor.bodyEncoding === 'json'
            ? 'application/json'
            : monitor.bodyEncoding === 'form'
              ? 'application/x-www-form-urlencoded'
              : 'text/plain';
      }
    }

    const response = await fetch(monitor.url, fetchInit);
    const elapsed = Date.now() - start;

    const expected = (monitor.expectedStatusCodes as number[]) ?? [200];
    const statusOk = expected.includes(response.status);

    let status: ProbeResult['status'];
    if (statusOk) {
      status = 'up';
    } else if (response.status >= 500) {
      status = 'down';
    } else {
      status = 'degraded';
    }

    if (monitor.upsideDownMode) {
      status = status === 'up' ? 'down' : 'up';
    }

    const certExpiryDays = await certificate;
    const result: ProbeResult = {
      status,
      responseTimeMs: elapsed,
      statusCode: response.status,
      errorMessage: statusOk ? null : `Status ${response.status}`,
      certExpiryDays,
      retryable: !statusOk,
    };
    return { ...result, ...applyCertificateHealth(result, certExpiryDays) };
  } catch (error) {
    const elapsed = Date.now() - start;
    const message = error instanceof Error ? error.message.slice(0, 200) : 'Unknown error';
    const status = monitor.upsideDownMode ? 'up' : 'down';

    const certExpiryDays = await certificate;
    const result: ProbeResult = {
      status,
      responseTimeMs: elapsed,
      statusCode: null,
      errorMessage: message.includes('abort') ? `Timed out after ${monitor.timeoutSeconds}s` : message,
      certExpiryDays,
      retryable: true,
    };
    return { ...result, ...applyCertificateHealth(result, certExpiryDays) };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Runs one monitor through its full probe cycle, including retries.
 *
 * The final result is what gets written. Intermediate failures are only
 * logged, not stored.
 */
async function probeWithRetries(
  monitor: typeof monitors.$inferSelect,
  logger: FastifyBaseLogger,
): Promise<ProbeResult> {
  let lastResult = await probeGate.run(() => probe(monitor));

  if (lastResult.status !== 'up' && lastResult.retryable && monitor.retries > 0) {
    for (let attempt = 0; attempt < monitor.retries; attempt++) {
      logger.info(
        `Monitor ${monitor.name} attempt ${attempt + 1}/${monitor.retries} failed: ${lastResult.errorMessage ?? lastResult.status}. Retrying.`,
      );

      await new Promise((resolve) => setTimeout(resolve, monitor.retryIntervalSeconds * 1000));
      lastResult = await probeGate.run(() => probe(monitor));

      if (lastResult.status === 'up' || !lastResult.retryable) break;
    }
  }

  return lastResult;
}

type StateChange = {
  monitorName: string;
  organizationId: string;
  contactPointId: string | null;
  from: string;
  to: string;
  responseTimeMs: number;
  statusCode: number | null;
  errorMessage: string | null;
};

async function publishStateChange(change: StateChange, logger: FastifyBaseLogger): Promise<void> {
  const fromLabel = change.from === 'pending' ? 'started' : change.from;
  const toLabel = change.to;
  const isDown = toLabel === 'down';
  const isRecovered = fromLabel === 'down' && toLabel === 'up';

  const title = isDown
    ? `Monitor down: ${change.monitorName}`
    : isRecovered
      ? `Monitor recovered: ${change.monitorName}`
      : `Monitor ${toLabel}: ${change.monitorName}`;

  const body = isDown
    ? `${change.monitorName} is ${toLabel}. ${change.errorMessage ?? `Status ${change.statusCode}`}`
    : isRecovered
      ? `${change.monitorName} is back up. Response ${change.responseTimeMs}ms.`
      : `${change.monitorName} changed from ${fromLabel} to ${toLabel}.`;

  await notify({
    organizationId: change.organizationId,
    source: 'alert',
    title,
    body,
    href: '/argus',
  });

  if (change.contactPointId) {
    const delivered = await deliver(change.contactPointId, title, body);
    const sending = summarise(delivered);
    if (sending) logger.info(`Argus alert delivery: ${sending}`);
  }
}

async function runMonitor(
  monitor: typeof monitors.$inferSelect,
  logger: FastifyBaseLogger,
): Promise<void> {
  const nextCheck = new Date(Date.now() + monitor.intervalSeconds * 1000);

  await db
    .update(monitors)
    .set({ nextCheckAt: nextCheck })
    .where(eq(monitors.id, monitor.id));

  const result = await probeWithRetries(monitor, logger);
  const previousStatus = monitor.currentStatus;
  const newStatus = result.status;

  const updateData: Record<string, unknown> = {
    currentStatus: newStatus,
    lastCheckedAt: new Date(),
    checkCount: monitor.checkCount + 1,
    updatedAt: new Date(),
    consecutiveDown: newStatus === 'up' ? 0 : monitor.consecutiveDown + (newStatus === 'down' ? 1 : 0),
  };

  if (newStatus === 'up') {
    updateData.upCount = monitor.upCount + 1;
  }

  await db.update(monitors).set(updateData).where(eq(monitors.id, monitor.id));

  await db.insert(heartbeats).values({
    monitorId: monitor.id,
    status: newStatus,
    responseTimeMs: result.responseTimeMs,
    statusCode: result.statusCode,
    errorMessage: result.errorMessage,
    certExpiryDays: result.certExpiryDays,
  });

  const changed = previousStatus !== newStatus && previousStatus !== 'pending';
  const recovered = previousStatus === 'down' && newStatus === 'up';
  const wentDown = previousStatus === 'up' && newStatus === 'down';

  if (changed || wentDown || recovered) {
    await publishStateChange(
      {
        monitorName: monitor.name,
        organizationId: monitor.organizationId,
        contactPointId: monitor.contactPointId,
        from: previousStatus,
        to: newStatus,
        responseTimeMs: result.responseTimeMs,
        statusCode: result.statusCode,
        errorMessage: result.errorMessage,
      },
      logger,
    );
  }

  logger.info(`Monitor ${monitor.name}: ${previousStatus} -> ${newStatus} (${result.responseTimeMs}ms)`);
}

/** Dispatches due monitors without waiting for their probes or retries. */
export async function runDue(logger: FastifyBaseLogger): Promise<{ scheduled: number }> {
  const activeMonitorIds = monitorJobs.keys();
  const dueWhere =
    activeMonitorIds.length > 0
      ? and(
          eq(monitors.active, true),
          lte(monitors.nextCheckAt, new Date()),
          notInArray(monitors.id, activeMonitorIds),
        )
      : and(eq(monitors.active, true), lte(monitors.nextCheckAt, new Date()));

  const due = await db
    .select()
    .from(monitors)
    .where(dueWhere)
    .orderBy(asc(monitors.nextCheckAt))
    .limit(MAX_DUE_PER_TICK);

  let scheduled = 0;
  for (const monitor of due) {
    const started = monitorJobs.start(
      monitor.id,
      () => runMonitor(monitor, logger),
      (error) =>
        logger.error(
          { err: error, monitorId: monitor.id, monitorName: monitor.name },
          'Argus monitor job failed.',
        ),
    );
    if (started) scheduled += 1;
  }

  return { scheduled };
}

/** Starts the prober timer. Returns a stop function for a clean shutdown. */
export function startProber(logger: FastifyBaseLogger): () => void {
  let dispatching = false;

  const tick = async () => {
    if (dispatching) return;
    dispatching = true;
    try {
      const { scheduled } = await runDue(logger);
      if (scheduled > 0) logger.info(`Argus dispatched ${scheduled} monitors.`);
    } catch (error) {
      logger.error(error);
    } finally {
      dispatching = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();

  return () => clearInterval(timer);
}

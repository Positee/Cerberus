import { and, asc, eq, isNotNull, lte, sql as raw } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../db/client.js';
import { organizations, scheduleRuns, schedules, tasks } from '../db/schema.js';
import { deliver, notify, summarise } from './deliver.js';
import {
  DORMANT_REASON,
  isDormant,
  nextRun,
  type Recurrence,
  type ReminderPayload,
  type ScheduleKind,
  type TaskPayload,
} from '../../../shared/schedules.js';

/**
 * The runner.
 *
 * It wakes every minute, asks which schedules are due, and fires them. A task
 * schedule makes a real task. A report or a scan records the run and says why
 * it did nothing, because neither engine exists yet.
 *
 * Every firing writes a run row, including the failures. A schedule that
 * silently stops is worse than one that visibly breaks.
 */

const TICK_MS = 60_000;

/** Fires one schedule. Returns what to write in its run row. */
async function fire(
  schedule: typeof schedules.$inferSelect,
): Promise<{ outcome: 'ok' | 'skipped' | 'failed'; note: string | null; taskId: string | null }> {
  const kind = schedule.kind as ScheduleKind;

  // Report and scan have no engine behind them yet, so they say so.
  if (isDormant(kind)) {
    return { outcome: 'skipped', note: DORMANT_REASON[kind], taskId: null };
  }

  // A reminder is only the words. Firing it is recording that it came due.
  if (kind === 'reminder') {
    const payload = schedule.payload as ReminderPayload;
    return { outcome: 'ok', note: payload?.note?.trim() || schedule.name, taskId: null };
  }

  const payload = schedule.payload as TaskPayload;
  if (!payload?.title) {
    return { outcome: 'failed', note: 'The schedule has no task title.', taskId: null };
  }

  // The task takes the next number from the workspace, exactly as a hand made
  // one does, so a scheduled task is indistinguishable afterwards.
  const created = await db.transaction(async (tx) => {
    const [org] = await tx
      .update(organizations)
      .set({ nextTaskNumber: raw`${organizations.nextTaskNumber} + 1` })
      .where(eq(organizations.id, schedule.organizationId))
      .returning({ number: organizations.nextTaskNumber });

    if (!org) return null;

    const [row] = await tx
      .insert(tasks)
      .values({
        organizationId: schedule.organizationId,
        number: org.number - 1,
        title: payload.title,
        description: payload.description ?? null,
        status: payload.status ?? 'backlogs',
        priority: payload.priority ?? 'normal',
        assigneeId: payload.assigneeId ?? null,
        createdBy: schedule.createdBy,
      })
      .returning({ id: tasks.id });

    return row ?? null;
  });

  if (!created) return { outcome: 'failed', note: 'The task was not written.', taskId: null };

  return { outcome: 'ok', note: null, taskId: created.id };
}

/** Runs everything that is due. Exported so a test or a route can force it. */
export async function runDue(logger?: FastifyBaseLogger): Promise<number> {
  const due = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.enabled, true), isNotNull(schedules.nextRunAt), lte(schedules.nextRunAt, new Date())))
    .orderBy(asc(schedules.nextRunAt))
    .limit(50);

  for (const schedule of due) {
    // The next time is set before the work runs. A schedule that throws still
    // moves forward, so one bad run cannot fire in a loop.
    const following = nextRun(schedule.recurrence as Recurrence, new Date());

    await db
      .update(schedules)
      .set({ nextRunAt: following, lastRunAt: new Date(), runCount: schedule.runCount + 1 })
      .where(eq(schedules.id, schedule.id));

    try {
      const result = await fire(schedule);

      // The bell always gets it, so a person has one place to look even when
      // every channel is down.
      const message = result.note ?? `${schedule.name} ran.`;
      await notify({
        organizationId: schedule.organizationId,
        source: 'schedule',
        title: schedule.name,
        body: message,
        href: '/scheduled',
      });

      const delivered = schedule.contactPointId
        ? await deliver(schedule.contactPointId, schedule.name, message)
        : [];

      const sending = summarise(delivered);

      await db.insert(scheduleRuns).values({
        scheduleId: schedule.id,
        outcome: result.outcome,
        note: [result.note, sending].filter(Boolean).join(' · ') || null,
        createdTaskId: result.taskId,
      });
      logger?.info(`Schedule ${schedule.name} ran: ${result.outcome}.`);
    } catch (error) {
      await db.insert(scheduleRuns).values({
        scheduleId: schedule.id,
        outcome: 'failed',
        note: error instanceof Error ? error.message.slice(0, 300) : 'The run failed.',
      });
      logger?.error(error);
    }
  }

  return due.length;
}

/** Starts the timer. Returns a stop function for a clean shutdown. */
export function startRunner(logger: FastifyBaseLogger): () => void {
  let running = false;

  const tick = async () => {
    // A slow tick must not overlap the next one.
    if (running) return;
    running = true;
    try {
      const fired = await runDue(logger);
      if (fired > 0) logger.info(`Ran ${fired} schedules.`);
    } catch (error) {
      logger.error(error);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();

  return () => clearInterval(timer);
}

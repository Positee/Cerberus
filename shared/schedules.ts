import type { TaskPriority, TaskStatus } from './tasks.js';

/**
 * Schedules.
 *
 * A schedule is a standing instruction: do this thing, again and again, on a
 * timer. It holds the recurrence and what to make. The runner reads the next
 * run time, does the work, then works out the next one.
 *
 * The recurrence is structured rather than a cron string. Cron is precise and
 * unreadable. A sentence is readable and vague. Structured fields give the
 * precision of cron, and describe() turns them back into the sentence.
 */

/* ------------------------------------------------------------------ what -- */

export type ScheduleKind = 'reminder' | 'task' | 'report' | 'scan';

export const KIND_LABEL: Record<ScheduleKind, string> = {
  reminder: 'Remind me',
  task: 'Create a task',
  report: 'Run a report',
  scan: 'Run a scan',
};

export const KIND_BLURB: Record<ScheduleKind, string> = {
  reminder: 'A nudge about something you do again and again, such as inbox triage.',
  task: 'Makes a real task in Tasks, ready for somebody to pick up.',
  report: 'Builds the reporting evidence for the period.',
  scan: 'Runs a scanner across your assets.',
};

/** What each kind carries. A task schedule holds the task it will make. */
export type TaskPayload = {
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string | null;
};

/**
 * A reminder carries only what to say.
 *
 * It tracks nothing and closes nothing. That is what separates it from a task:
 * a reminder is a nudge, and a task is work somebody owns.
 */
export type ReminderPayload = { note: string };

export type ReportPayload = { period: 'week' | 'month' | 'quarter' };
export type ScanPayload = { source: string; scope: string };

export type SchedulePayload = ReminderPayload | TaskPayload | ReportPayload | ScanPayload;

/* ------------------------------------------------------------ recurrence -- */

export type Cadence = 'daily' | 'weekly' | 'monthly';

export const CADENCE_LABEL: Record<Cadence, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export type Recurrence = {
  cadence: Cadence;
  /** Daily and monthly only. Every N days, or every N months. */
  interval: number;
  /** Weekly only. 0 is Sunday. */
  weekdays: number[];
  /** Monthly only. 1 to 31. A short month uses its last day. */
  dayOfMonth: number;
  /** The time of day, as HH:MM. Held in UTC. */
  timeOfDay: string;
};

export const DEFAULT_RECURRENCE: Recurrence = {
  cadence: 'weekly',
  interval: 1,
  weekdays: [1],
  dayOfMonth: 1,
  timeOfDay: '09:00',
};

export const WEEKDAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const ones = value % 10;
  if (ones === 1) return `${value}st`;
  if (ones === 2) return `${value}nd`;
  if (ones === 3) return `${value}rd`;
  return `${value}th`;
}

/** Joins names the way a person writes them. */
function joinWords(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  const last = items[items.length - 1] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${last}`;
}

/** Turns the fields back into the sentence a person would write. */
export function describe(rec: Recurrence): string {
  const at = `at ${rec.timeOfDay}`;

  if (rec.cadence === 'daily') {
    return rec.interval === 1 ? `Every day ${at}` : `Every ${rec.interval} days ${at}`;
  }

  if (rec.cadence === 'weekly') {
    const days = [...rec.weekdays].sort();
    if (days.length === 0) return `Every week ${at}`;
    if (days.length === 7) return `Every day ${at}`;
    return `Every ${joinWords(days.map((day) => WEEKDAY_LABEL[day] ?? ''))} ${at}`;
  }

  const day = `the ${ordinal(rec.dayOfMonth)}`;
  return rec.interval === 1
    ? `On ${day} of every month ${at}`
    : `On ${day}, every ${rec.interval} months ${at}`;
}

/**
 * Works out when this runs next, strictly after `from`.
 *
 * Both sides call it. The screen shows the answer before a person saves, and
 * the runner stores it so a due schedule is one indexed lookup.
 */
export function nextRun(rec: Recurrence, from: Date = new Date()): Date {
  const [hourText, minuteText] = rec.timeOfDay.split(':');
  const hour = Number(hourText) || 0;
  const minute = Number(minuteText) || 0;

  const atTimeOn = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month, day, hour, minute, 0, 0));

  if (rec.cadence === 'daily') {
    const step = Math.max(1, rec.interval);
    const candidate = atTimeOn(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    while (candidate.getTime() <= from.getTime()) {
      candidate.setUTCDate(candidate.getUTCDate() + step);
    }
    return candidate;
  }

  if (rec.cadence === 'weekly') {
    const days = rec.weekdays.length > 0 ? rec.weekdays : [from.getUTCDay()];
    // Walk forward a day at a time. Two weeks always contains a match.
    for (let ahead = 0; ahead <= 14; ahead += 1) {
      const candidate = atTimeOn(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + ahead);
      if (candidate.getTime() > from.getTime() && days.includes(candidate.getUTCDay())) return candidate;
    }
  }

  // Monthly. A month too short for the chosen day uses its last day, so the
  // 31st still fires in February.
  const step = Math.max(1, rec.interval);
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();

  for (let tries = 0; tries < 60; tries += 1) {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const candidate = atTimeOn(year, month, Math.min(rec.dayOfMonth, lastDay));
    if (candidate.getTime() > from.getTime()) return candidate;
    month += step;
    year += Math.floor(month / 12);
    month %= 12;
  }

  return atTimeOn(from.getUTCFullYear(), from.getUTCMonth() + 1, rec.dayOfMonth);
}

/* --------------------------------------------------------------- records -- */

export type ScheduleRun = {
  id: string;
  ranAt: string;
  outcome: 'ok' | 'failed' | 'skipped';
  note: string | null;
  createdTaskRef: string | null;
};

export type Schedule = {
  id: string;
  name: string;
  kind: ScheduleKind;
  enabled: boolean;
  recurrence: Recurrence;
  payload: SchedulePayload;
  /** Where the result is sent. Null means the bell only. */
  contactPointId: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  createdAt: string;
  recentRuns: ScheduleRun[];
};

export type SaveScheduleRequest = {
  name: string;
  kind: ScheduleKind;
  enabled: boolean;
  recurrence: Recurrence;
  payload: SchedulePayload;
  contactPointId?: string | null;
};

/** True when a kind cannot do anything yet, because its engine is missing. */
export function isDormant(kind: ScheduleKind): boolean {
  return kind === 'report' || kind === 'scan';
}

export const DORMANT_REASON: Record<ScheduleKind, string | null> = {
  reminder: null,
  task: null,
  report: 'Reporting runs on placeholder data, so this records the run without building a report.',
  scan: 'No scanner is connected yet, so this records the run without scanning anything.',
};

/* ----------------------------------------------------------------- state -- */

/** How a person narrows the list. */
export type ScheduleFilter = 'all' | 'active' | 'paused' | 'never';

export const FILTER_LABEL: Record<ScheduleFilter, string> = {
  all: 'All',
  active: 'Active',
  paused: 'Paused',
  never: 'Never run',
};

export function matchesFilter(schedule: Schedule, filter: ScheduleFilter): boolean {
  if (filter === 'active') return schedule.enabled;
  if (filter === 'paused') return !schedule.enabled;
  if (filter === 'never') return schedule.runCount === 0;
  return true;
}

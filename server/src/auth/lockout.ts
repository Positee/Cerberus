import { eq, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { loginAttempts } from '../db/schema.js';

/**
 * The sign in lock.
 *
 * Four wrong passwords lock the address for five minutes. The next wrong one
 * after that locks it for fifteen, then thirty, and thirty from then on.
 *
 * The count is kept against the address rather than the account, so an address
 * that belongs to nobody behaves exactly like one that does. A lock that only
 * happened for real accounts would answer the question "does this email exist".
 */

/** Wrong tries before the first lock. */
export const FAILURES_BEFORE_LOCK = 4;

/** How long each lock lasts, in minutes. The last value repeats for ever. */
export const LOCK_LADDER = [5, 15, 30];

/**
 * How long a run of failures stays warm.
 *
 * Three wrong tries yesterday should not join one today to make a lock. A run
 * older than this starts again from zero.
 */
const RUN_WINDOW_MINUTES = 30;

export type LockState = {
  locked: boolean;
  /** Whole minutes left, rounded up. Zero when it is not locked. */
  minutesLeft: number;
};

function minutesFor(lockCount: number): number {
  const index = Math.min(lockCount, LOCK_LADDER.length - 1);
  return LOCK_LADDER[index] ?? 30;
}

/** Reads the lock. Called before a password is ever checked. */
export async function checkLock(email: string): Promise<LockState> {
  const [row] = await db.select().from(loginAttempts).where(eq(loginAttempts.email, email)).limit(1);

  if (!row?.lockedUntil) return { locked: false, minutesLeft: 0 };

  const left = row.lockedUntil.getTime() - Date.now();
  if (left <= 0) return { locked: false, minutesLeft: 0 };

  return { locked: true, minutesLeft: Math.ceil(left / 60000) };
}

/**
 * Counts one failure, and locks when the run reaches the limit.
 *
 * Returns the state after counting, so the caller can tell somebody they are
 * now locked rather than making them try once more to find out.
 */
export async function noteFailure(email: string): Promise<LockState> {
  const now = new Date();
  const [row] = await db.select().from(loginAttempts).where(eq(loginAttempts.email, email)).limit(1);

  if (!row) {
    await db.insert(loginAttempts).values({ email, failures: 1, lastFailedAt: now });
    return { locked: false, minutesLeft: 0 };
  }

  // A stale run starts again, so old failures cannot add up over days.
  const stale = now.getTime() - row.lastFailedAt.getTime() > RUN_WINDOW_MINUTES * 60000;
  const failures = (stale ? 0 : row.failures) + 1;

  if (failures < FAILURES_BEFORE_LOCK) {
    await db
      .update(loginAttempts)
      .set({ failures, lastFailedAt: now })
      .where(eq(loginAttempts.email, email));
    return { locked: false, minutesLeft: 0 };
  }

  const lockCount = row.lockCount + 1;
  const minutes = minutesFor(row.lockCount);
  const until = new Date(now.getTime() + minutes * 60000);

  await db
    .update(loginAttempts)
    .set({ failures: 0, lockCount, lockedUntil: until, lastFailedAt: now })
    .where(eq(loginAttempts.email, email));

  return { locked: true, minutesLeft: minutes };
}

/**
 * Clears the record after a correct password.
 *
 * The ladder resets too. Somebody who signs in should not carry a longer lock
 * into next month because of a bad week.
 */
export async function clearFailures(email: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
}

/** Housekeeping. Drops rows nobody is waiting on. */
export async function purgeStaleAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const removed = await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.lastFailedAt, cutoff))
    .returning({ email: loginAttempts.email });
  return removed.length;
}

/** The sentence a locked person reads. */
export function lockMessage(minutesLeft: number): string {
  const unit = minutesLeft === 1 ? 'minute' : 'minutes';
  return `Too many wrong tries. Sign in is locked for ${minutesLeft} ${unit}.`;
}

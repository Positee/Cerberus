/**
 * Plans.
 *
 * One file decides what a plan unlocks, what it caps, and what it costs. The
 * sidebar reads it to draw a lock, the router reads it to send somebody to the
 * upgrade page, and the API reads it to refuse a write. A second copy is how a
 * screen and a server start to disagree.
 *
 * Nothing here charges anybody. Billing is not connected, so a plan changes in
 * the database. See PLAN_CHANGE_NOTE.
 */

export type Plan = 'free' | 'pro' | 'enterprise';

export type BillingPeriod = 'monthly' | 'yearly';

/** Worst to best. A plan holds everything the plans before it hold. */
export const PLAN_ORDER: Plan[] = ['free', 'pro', 'enterprise'];

export const PLAN_LABEL: Record<Plan, string> = {
  free: 'Free',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

export const PLAN_BLURB: Record<Plan, string> = {
  free: 'See your risk and decide what matters.',
  pro: 'Act on it, on a timer, as a team.',
  enterprise: 'Everything, without a ceiling.',
};

export function planRank(plan: Plan): number {
  return PLAN_ORDER.indexOf(plan);
}

/** True when the workspace plan reaches the plan a thing needs. */
export function planReaches(current: Plan, needed: Plan): boolean {
  return planRank(current) >= planRank(needed);
}

/* ----------------------------------------------------------------- price -- */

export type Price = {
  /** US dollars a month. Zero is free. Null means the price is not published. */
  monthly: number | null;
  /** US dollars a year. Null means the price is not published. */
  yearly: number | null;
};

/**
 * Prices in US dollars.
 *
 * The yearly figure is ten months, so a year costs two months less than paying
 * by the month. Enterprise publishes no price, because the shape of the deal
 * changes with the size of the team.
 */
export const PRICE: Record<Plan, Price> = {
  free: { monthly: 0, yearly: 0 },
  pro: { monthly: 19, yearly: 190 },
  enterprise: { monthly: null, yearly: null },
};

/** What a year saves, as a percentage. Null when there is no published price. */
export function yearlySaving(plan: Plan): number | null {
  const price = PRICE[plan];
  if (price.monthly === null || price.yearly === null || price.monthly === 0) return null;

  const full = price.monthly * 12;
  return Math.round(((full - price.yearly) / full) * 100);
}

/* --------------------------------------------------------------- modules -- */

/**
 * The plan each module needs.
 *
 * A module missing from this map is free. Listing only what is gated keeps the
 * map short, and it means a new module is open until somebody decides to sell
 * it.
 */
export const MODULE_PLAN: Record<string, Plan> = {
  '/scheduled': 'pro',
  '/argus': 'pro',
  '/tasks': 'pro',
  '/invites': 'pro',
  '/knowledge-base': 'pro',
  '/inbox': 'enterprise',
};

/** The plan a path needs, or free when nothing gates it. */
export function planForModule(path: string): Plan {
  return MODULE_PLAN[path] ?? 'free';
}

/* ---------------------------------------------------------------- limits -- */

/**
 * What a plan caps.
 *
 * Null means no cap. A cap is counted against what already exists, so lowering
 * a plan never deletes anything. It only stops the next one being made.
 */
export type Limits = {
  /** People in the workspace, counting the owner. */
  seats: number | null;
  alertRules: number | null;
  contactPoints: number | null;
  monitors: number | null;
  schedules: number | null;
  projects: number | null;
  /**
   * How far back history reaches, in days. It covers the audit trail, uptime
   * heartbeats, and schedule runs. Null means everything is kept.
   */
  historyDays: number | null;
};

export const LIMITS: Record<Plan, Limits> = {
  free: {
    seats: 1,
    alertRules: 3,
    contactPoints: 1,
    monitors: 0,
    schedules: 0,
    projects: 3,
    historyDays: 7,
  },
  pro: {
    seats: 20,
    alertRules: 50,
    contactPoints: 10,
    monitors: 10,
    schedules: 25,
    projects: null,
    historyDays: 90,
  },
  enterprise: {
    seats: null,
    alertRules: null,
    contactPoints: null,
    monitors: null,
    schedules: null,
    projects: null,
    historyDays: null,
  },
};

export type LimitKey = keyof Limits;

export const LIMIT_LABEL: Record<LimitKey, string> = {
  seats: 'Members',
  alertRules: 'Alert rules',
  contactPoints: 'Contact points',
  monitors: 'Uptime monitors',
  schedules: 'Schedules',
  projects: 'Projects',
  historyDays: 'History',
};

/** The label for one of something. "1 contact points" reads as a bug. */
export const LIMIT_LABEL_ONE: Record<LimitKey, string> = {
  seats: 'member',
  alertRules: 'alert rule',
  contactPoints: 'contact point',
  monitors: 'uptime monitor',
  schedules: 'schedule',
  projects: 'project',
  historyDays: 'day of history',
};

/** Counts a thing, in the words a person would use. */
export function countLimit(key: LimitKey, howMany: number): string {
  const noun = howMany === 1 ? LIMIT_LABEL_ONE[key] : LIMIT_LABEL[key].toLowerCase();
  return `${howMany} ${noun}`;
}

/** Reads a cap for a screen. */
export function describeLimit(key: LimitKey, plan: Plan): string {
  const value = LIMITS[plan][key];
  if (value === null) return key === 'historyDays' ? 'Kept for good' : 'Unlimited';
  if (key === 'historyDays') return `${value} days`;
  return String(value);
}

/**
 * True when one more would break the cap.
 *
 * The API asks this before it writes. A screen asks it to disable a button,
 * which is a courtesy, never a control.
 */
export function wouldExceed(key: LimitKey, plan: Plan, current: number): boolean {
  const cap = LIMITS[plan][key];
  if (cap === null) return false;
  return current >= cap;
}

/** The lowest plan that allows one more of something. */
export function planThatAllows(key: LimitKey, current: number): Plan | null {
  return PLAN_ORDER.find((plan) => !wouldExceed(key, plan, current)) ?? null;
}

/* ------------------------------------------------------------- the cards -- */

/** What a plan card lists. Written for a person choosing, not for a lawyer. */
export const PLAN_FEATURES: Record<Plan, string[]> = {
  free: [
    'Dashboard, Issues, and Assets',
    'Alerting with 3 rules and 1 contact point',
    'Projects, Reporting, and Audit',
    'One member',
    '7 days of history',
  ],
  pro: [
    'Scheduled, so work runs on a timer',
    'Uptime, watching 10 services',
    'Tasks, to track a fix to done',
    'Invite up to 20 people',
    'The Knowledge base, on a personal workspace',
    '50 alert rules and 10 contact points',
    '90 days of history',
  ],
  enterprise: [
    'Inbox, for talking inside the workspace',
    'No cap on anything',
    'History kept for good',
    'Priority support',
  ],
};

/** Shown wherever somebody tries to pay. Billing is not connected yet. */
export const PLAN_CHANGE_NOTE =
  'Billing is not connected yet, so nothing charges you. Ask an admin to change the plan.';

/* --------------------------------------------------------- what a screen sees -- */

export type Subscription = {
  plan: Plan;
  period: BillingPeriod;
  /** When the plan last changed. */
  since: string;
};

/** How much of each cap is used right now. */
export type Usage = Record<LimitKey, number>;

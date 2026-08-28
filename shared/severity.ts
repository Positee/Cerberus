/**
 * Severity.
 *
 * The browser draws it and the API stores it, so the list lives here and both
 * sides read the same one. The colours stay in src/app.css, because a colour
 * is a decision for the screen alone.
 *
 * A severity mark always carries its name. Never encode severity with colour
 * alone. See CLAUDE.md.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** Worst first. Every list of severities renders in this order. */
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** Higher bites harder. Used to compare, never to display. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function isSeverity(value: string): value is Severity {
  return value in SEVERITY_RANK;
}

/** The severities at or above a floor, worst first. */
export function severitiesAtLeast(floor: Severity): Severity[] {
  return SEVERITY_ORDER.filter((level) => SEVERITY_RANK[level] >= SEVERITY_RANK[floor]);
}

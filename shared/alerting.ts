import type { Severity } from './severity.js';

/**
 * Alerting.
 *
 * Three pieces, and each answers one question.
 *
 *   A rule           decides what is worth waking somebody about.
 *   A contact point  decides how a person hears about it.
 *   A policy         decides which contact point hears about which alert.
 *
 * A rule never names a contact point. It attaches labels, and the policy
 * routes on those labels. That is what lets you change who is on call without
 * touching a single rule.
 */

/* ------------------------------------------------------------------ rules -- */

/** What happened. A rule watches exactly one of these. */
export type AlertTrigger =
  | 'finding.raised'
  | 'finding.reopened'
  | 'sla.breached'
  | 'scanner.offline'
  | 'asset.exposed';

export const TRIGGER_LABEL: Record<AlertTrigger, string> = {
  'finding.raised': 'A finding is raised',
  'finding.reopened': 'A closed finding comes back',
  'sla.breached': 'A finding passes its SLA',
  'scanner.offline': 'A scanner stops reporting',
  'asset.exposed': 'An asset becomes reachable from outside',
};

export const TRIGGER_BLURB: Record<AlertTrigger, string> = {
  'finding.raised': 'Cerberus finds something new.',
  'finding.reopened': 'Something you fixed is back.',
  'sla.breached': 'The clock ran out on a fix.',
  'scanner.offline': 'A source went quiet, so you are blind to part of the estate.',
  'asset.exposed': 'A bucket, a port, or a service opened to the internet.',
};

/**
 * The condition.
 *
 * Each filter holds one value, or null for any. One rule answers one question,
 * so a rule that should cover two severities is two rules. That keeps a rule
 * readable, and it keeps the label it fires with unambiguous.
 */
export type AlertCondition = {
  trigger: AlertTrigger;
  /** Fires only for this severity. Null means any severity. */
  severity: Severity | null;
  /** Fires only for this scanner. Null means any source. */
  source: string | null;
  /** Fires only for this asset kind. Null means any kind. */
  assetKind: string | null;
  /**
   * How many matching events before it fires, and over how long.
   *
   * A count of 1 fires on the first event. A higher count with a window is
   * how you catch a burst without waking somebody for a single item.
   */
  count: number;
  windowMinutes: number;
};

/**
 * Reads a stored condition.
 *
 * An earlier shape held a list per filter. A row written then still loads, and
 * takes the first value it named.
 */
export function normaliseCondition(raw: unknown): AlertCondition {
  const value = (raw ?? {}) as Record<string, unknown>;
  const first = (single: unknown, list: unknown): string | null => {
    if (typeof single === 'string' && single) return single;
    if (Array.isArray(list) && typeof list[0] === 'string') return list[0];
    return null;
  };

  return {
    trigger: (value.trigger as AlertTrigger) ?? 'finding.raised',
    severity: first(value.severity, value.severities) as Severity | null,
    source: first(value.source, value.sources),
    assetKind: first(value.assetKind, value.assetKinds),
    count: typeof value.count === 'number' ? value.count : 1,
    windowMinutes: typeof value.windowMinutes === 'number' ? value.windowMinutes : 0,
  };
}

export type AlertRule = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  /** The severity this rule gives its own alert, whatever it matched. */
  severity: Severity;
  condition: AlertCondition;
  /** Attached to every alert this rule fires. The policy routes on these. */
  labels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type SaveAlertRuleRequest = {
  name: string;
  description?: string;
  enabled: boolean;
  severity: Severity;
  condition: AlertCondition;
  labels: Record<string, string>;
};

export const DEFAULT_CONDITION: AlertCondition = {
  trigger: 'finding.raised',
  severity: 'critical',
  source: null,
  assetKind: null,
  count: 1,
  windowMinutes: 0,
};

/* --------------------------------------------------------- contact points -- */

/** How a person hears about an alert. */
export type IntegrationType = 'email' | 'google_chat' | 'slack' | 'webhook' | 'phone' | 'sms';

export const INTEGRATION_LABEL: Record<IntegrationType, string> = {
  email: 'Email',
  google_chat: 'Google Chat',
  slack: 'Slack',
  webhook: 'Webhook',
  phone: 'Phone call',
  sms: 'Text message',
};

export const INTEGRATION_BLURB: Record<IntegrationType, string> = {
  email: 'Sends a message to one or more addresses.',
  google_chat: 'Posts into a Google Space through an incoming webhook.',
  slack: 'Posts into a Slack channel through an incoming webhook.',
  webhook: 'Posts the alert as JSON to any URL you control.',
  phone: 'Calls a number and reads the alert out.',
  sms: 'Sends a text message to a number.',
};

/**
 * What each kind needs.
 *
 * A secret field never comes back from the API once it is saved. The reply
 * carries a masked hint instead, so a screen can show that a value exists
 * without handing it back to the browser.
 */
export type IntegrationField = {
  key: string;
  label: string;
  placeholder: string;
  /** True when the API refuses to send the value back after it is saved. */
  secret?: boolean;
  /** True when one integration may hold several values. */
  list?: boolean;
};

export const INTEGRATION_FIELDS: Record<IntegrationType, IntegrationField[]> = {
  email: [{ key: 'addresses', label: 'Email addresses', placeholder: 'oncall@acme.com', list: true }],
  google_chat: [
    { key: 'url', label: 'Space webhook URL', placeholder: 'https://chat.googleapis.com/v1/spaces/...', secret: true },
    { key: 'space', label: 'Space name', placeholder: 'Security alerts' },
  ],
  slack: [
    { key: 'url', label: 'Incoming webhook URL', placeholder: 'https://hooks.slack.com/services/...', secret: true },
    { key: 'channel', label: 'Channel', placeholder: '#security' },
  ],
  webhook: [
    { key: 'url', label: 'URL', placeholder: 'https://example.com/hooks/cerberus' },
    { key: 'token', label: 'Bearer token', placeholder: 'Optional', secret: true },
  ],
  phone: [{ key: 'numbers', label: 'Phone numbers', placeholder: '+234 800 000 0000', list: true }],
  sms: [{ key: 'numbers', label: 'Phone numbers', placeholder: '+234 800 000 0000', list: true }],
};

export type Integration = {
  type: IntegrationType;
  /** Public values only. A secret arrives as a masked hint such as "...a91f". */
  settings: Record<string, string | string[]>;
  /** Which keys hold a stored secret. The value itself never leaves the API. */
  secrets: string[];
};

export type ContactPoint = {
  id: string;
  name: string;
  integrations: Integration[];
  /** True when no policy sends anything here. */
  unused: boolean;
  createdAt: string;
};

export type SaveContactPointRequest = {
  name: string;
  integrations: Array<{
    type: IntegrationType;
    settings: Record<string, string | string[]>;
  }>;
};

/* ---------------------------------------------------------------- routing -- */

/** One test against an alert's labels. */
export type Matcher = {
  label: string;
  operator: '=' | '!=';
  value: string;
};

export type NotificationRoute = {
  id: string;
  /** Lower runs first. The first match wins unless it says to continue. */
  position: number;
  matchers: Matcher[];
  contactPointId: string;
  /** Keep testing later routes after this one matches. */
  continueMatching: boolean;
};

/**
 * The root of the routing.
 *
 * Anything no route claims lands on the default contact point, so an alert can
 * never be silently dropped.
 */
export type NotificationPolicy = {
  defaultContactPointId: string | null;
  /** Alerts sharing these label values arrive as one message. */
  groupBy: string[];
  /** Wait this long to collect the first batch. */
  groupWaitSeconds: number;
  /** Wait this long before sending an update to an open group. */
  groupIntervalSeconds: number;
  /** Say it again after this long if nobody has resolved it. */
  repeatIntervalSeconds: number;
  routes: NotificationRoute[];
};

export type SaveNotificationPolicyRequest = {
  defaultContactPointId: string | null;
  groupBy: string[];
  groupWaitSeconds: number;
  groupIntervalSeconds: number;
  repeatIntervalSeconds: number;
  routes: Array<Omit<NotificationRoute, 'id'>>;
};

export const DEFAULT_POLICY: Omit<NotificationPolicy, 'routes' | 'defaultContactPointId'> = {
  groupBy: ['severity', 'source'],
  groupWaitSeconds: 30,
  groupIntervalSeconds: 300,
  repeatIntervalSeconds: 14400,
};

/**
 * Finds the contact point for one alert.
 *
 * Both sides import this. The API uses it to send. The screen uses it to show
 * a person where a rule's alert will land before they save the rule.
 */
export function routeFor(
  labels: Record<string, string>,
  policy: NotificationPolicy,
): { contactPointIds: string[]; matchedRouteIds: string[] } {
  const contactPointIds: string[] = [];
  const matchedRouteIds: string[] = [];

  const ordered = [...policy.routes].sort((a, b) => a.position - b.position);

  for (const route of ordered) {
    const hit = route.matchers.every((matcher) => {
      const actual = labels[matcher.label] ?? '';
      return matcher.operator === '=' ? actual === matcher.value : actual !== matcher.value;
    });

    if (!hit) continue;

    matchedRouteIds.push(route.id);
    if (!contactPointIds.includes(route.contactPointId)) contactPointIds.push(route.contactPointId);
    if (!route.continueMatching) break;
  }

  // Nothing claimed it, so the default catches it. An alert is never dropped.
  if (contactPointIds.length === 0 && policy.defaultContactPointId) {
    contactPointIds.push(policy.defaultContactPointId);
  }

  return { contactPointIds, matchedRouteIds };
}

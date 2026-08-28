/**
 * Keyboard shortcuts.
 *
 * One list. The handler reads it to act, and the modal reads it to teach. A
 * second copy is how a shortcut starts working without appearing in the help,
 * or appearing in the help without working.
 *
 * Two shapes, borrowed from the editors people already know. A single key acts
 * at once. A "go to" is the letter g, then a letter, which keeps the whole
 * workspace reachable without burning a modifier on each module.
 */

export type ShortcutGroup = 'go' | 'do' | 'edit';

export const GROUP_LABEL: Record<ShortcutGroup, string> = {
  go: 'Go to',
  do: 'Do',
  edit: 'While typing',
};

export type Shortcut = {
  id: string;
  /** The keys as a person reads them, such as ['g', 'd'] or ['⌘', 'K']. */
  keys: string[];
  label: string;
  group: ShortcutGroup;
  /** Where it goes. Only a "go to" has one. */
  to?: string;
  /** True when the module is not built, so the modal can say so. */
  placeholder?: boolean;
};

/**
 * The letter each module answers to.
 *
 * Chosen from the module name where it is free, so the pairing is memorable.
 * Audit takes l for log, because a is taken by Alerting.
 */
export const SHORTCUTS: Shortcut[] = [
  { id: 'go-dashboard', keys: ['g', 'd'], label: 'Dashboard', group: 'go', to: '/dashboard' },
  { id: 'go-issues', keys: ['g', 'i'], label: 'Issues', group: 'go', to: '/issues', placeholder: true },
  { id: 'go-alerting', keys: ['g', 'a'], label: 'Alerting', group: 'go', to: '/alerting' },
  { id: 'go-uptime', keys: ['g', 'u'], label: 'Uptime', group: 'go', to: '/argus' },
  { id: 'go-scheduled', keys: ['g', 'c'], label: 'Scheduled', group: 'go', to: '/scheduled' },
  { id: 'go-tasks', keys: ['g', 't'], label: 'Tasks', group: 'go', to: '/tasks' },
  { id: 'go-projects', keys: ['g', 'p'], label: 'Projects', group: 'go', to: '/projects' },
  { id: 'go-workspace', keys: ['g', 'w'], label: 'Workspace', group: 'go', to: '/workspace' },
  { id: 'go-inbox', keys: ['g', 'n'], label: 'Inbox', group: 'go', to: '/inbox' },
  { id: 'go-reporting', keys: ['g', 'r'], label: 'Reporting', group: 'go', to: '/reporting' },
  { id: 'go-audit', keys: ['g', 'l'], label: 'Audit log', group: 'go', to: '/audit' },
  { id: 'go-settings', keys: ['g', 's'], label: 'Settings', group: 'go', to: '/settings' },
  { id: 'go-profile', keys: ['g', 'm'], label: 'Your profile', group: 'go', to: '/profile' },
  { id: 'go-help', keys: ['g', 'h'], label: 'Help', group: 'go', to: '/help' },

  { id: 'help', keys: ['?'], label: 'Show this list', group: 'do' },
  { id: 'search', keys: ['/'], label: 'Jump to the search box', group: 'do' },
  { id: 'create', keys: ['c'], label: 'Create, on a page that makes things', group: 'do' },
  { id: 'rail', keys: ['['], label: 'Widen or narrow the sidebar', group: 'do' },
  { id: 'back', keys: ['u'], label: 'Go back a page', group: 'do' },

  { id: 'close', keys: ['Esc'], label: 'Close what is open', group: 'edit' },
  { id: 'submit', keys: ['⌘', 'Enter'], label: 'Send a comment or save a form', group: 'edit' },
];

export function shortcutsIn(group: ShortcutGroup): Shortcut[] {
  return SHORTCUTS.filter((shortcut) => shortcut.group === group);
}

/** The second letter of every "go to", for the handler to look up. */
export const GO_TO: Record<string, string> = Object.fromEntries(
  SHORTCUTS.filter((shortcut) => shortcut.group === 'go' && shortcut.to).map((shortcut) => [
    shortcut.keys[1] ?? '',
    shortcut.to ?? '',
  ]),
);

/**
 * True when a key press belongs to whatever the person is typing in.
 *
 * Without this, typing "c" into a comment box would open the create form and
 * eat the letter. A shortcut must never steal a keystroke from a field.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;

  return target.isContentEditable;
}

/** The pages where c makes something, and what it makes. */
export const CREATE_ON: Record<string, string> = {
  '/tasks': 'a task',
  '/scheduled': 'a schedule',
  '/argus': 'a monitor',
  '/projects': 'a project',
  '/alerting/rules': 'an alert rule',
  '/alerting/contact-points': 'a contact point',
  '/invites': 'an invitation',
};

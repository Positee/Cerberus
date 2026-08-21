/**
 * The help content.
 *
 * Held as data rather than markup, so one search can read every answer and a
 * future page can reuse them.
 *
 * Two rules for anything written here.
 *
 * Say what a module does today, not what it will do. A person reading help is
 * usually stuck, and a promise reads as a lie when the button is missing.
 *
 * Name the state plainly. A module that stores but does not act says so.
 */

export type HelpState = 'live' | 'partial' | 'planned';

export const STATE_LABEL: Record<HelpState, string> = {
  live: 'Working',
  partial: 'Part built',
  planned: 'Not built yet',
};

export type HelpEntry = {
  id: string;
  question: string;
  answer: string;
  /** Extra lines, shown as a list under the answer. */
  points?: string[];
  /** Where to go and try it. */
  to?: string;
  state?: HelpState;
  /** Extra words that should match this entry in a search. */
  keywords?: string[];
};

export type HelpSection = {
  id: string;
  title: string;
  blurb: string;
  entries: HelpEntry[];
};

export const HELP: HelpSection[] = [
  {
    id: 'start',
    title: 'Start here',
    blurb: 'What Cerberus is for, and how to find your way around it.',
    entries: [
      {
        id: 'what',
        question: 'What is Cerberus?',
        answer:
          'Cerberus watches the security of your systems in one place. A team usually runs several scanners, and each one reports on its own, so nobody sees the whole picture. Cerberus collects what they find, decides what deserves attention, tells the right person, and tracks the fix until it closes.',
        points: [
          'See: every asset and finding in one view.',
          'Decide: rules judge what matters, by severity, source, and asset.',
          'Tell: policies route each alert to the right person and channel.',
          'Fix: tasks track the work until somebody closes it.',
        ],
        keywords: ['about', 'overview', 'purpose', 'what does it do'],
      },
      {
        id: 'paths',
        question: 'What is the difference between a personal and an organization account?',
        answer:
          'A personal workspace is flat. Everybody in it works at the same level as the owner. An organization workspace has a hierarchy, so an admin invites people and decides what a plain member may do.',
        points: [
          'Personal gets the Knowledge base module.',
          'An organization gets Tasks and Audit.',
          'Both get everything else, including Alerting and Scheduled.',
        ],
        keywords: ['personal', 'organization', 'team', 'account type', 'difference'],
      },
      {
        id: 'layout',
        question: 'How is the app laid out?',
        answer:
          'The rail on the left holds the modules, grouped by what they are for. Monitor is what Cerberus watches. Work is what your team does about it. Records is the evidence. Settings and Help sit at the bottom.',
        points: [
          'The bell, beside the search box, holds anything Cerberus did for you.',
          'Your picture opens the account menu, with your profile and your plan.',
          'The arrow at the far left of the bar takes you back a page.',
        ],
        keywords: ['sidebar', 'navigation', 'menu', 'rail', 'layout'],
      },
      {
        id: 'first',
        question: 'What should I set up first?',
        answer:
          'Start with a contact point, because nothing can reach you until one exists. Then write an alert rule, so Cerberus knows what is worth your attention. Then add a schedule for anything you do again and again.',
        to: '/alerting/contact-points',
        keywords: ['getting started', 'setup', 'first steps', 'onboarding'],
      },
    ],
  },
  {
    id: 'alerting',
    title: 'Alerting',
    blurb: 'Deciding what is worth an interruption, and who hears about it.',
    entries: [
      {
        id: 'alerting-parts',
        question: 'What are the three parts of Alerting?',
        answer:
          'Each one answers a different question. A rule decides what is worth waking somebody about. A contact point decides how a person hears about it. A policy decides which alert reaches which contact point.',
        points: [
          'A rule never names a person. It attaches labels.',
          'A policy routes on those labels.',
          'So you can change who is on call without touching a single rule.',
        ],
        to: '/alerting',
        state: 'partial',
        keywords: ['alert', 'rules', 'contact points', 'policies', 'notification'],
      },
      {
        id: 'alerting-rule',
        question: 'How do I write an alert rule?',
        answer:
          'A rule reads as one sentence, top to bottom. Choose the trigger, then narrow it by severity, source, and asset. Each filter takes one value or Any, because one rule should answer one question. If you need two severities, write two rules.',
        points: [
          'Set a count above one to catch a burst instead of a single finding.',
          'Labels you attach are what the policy routes on.',
        ],
        to: '/alerting/rules',
        state: 'partial',
        keywords: ['rule', 'severity', 'trigger', 'condition', 'threshold'],
      },
      {
        id: 'alerting-contact',
        question: 'How do I get alerts into Slack or Google Chat?',
        answer:
          'Make a contact point and add an integration to it. For Slack or Google Chat, paste the incoming webhook URL from that service. Cerberus stores the URL as a secret and never shows it again, so the screen shows a masked hint instead.',
        points: [
          'Slack, Google Chat, and plain webhooks send for real today.',
          'Email, phone, and text need a provider account, which is not connected yet.',
          'One contact point can hold several ways to reach people.',
        ],
        to: '/alerting/contact-points',
        state: 'partial',
        keywords: ['slack', 'google chat', 'webhook', 'email', 'sms', 'phone', 'integration'],
      },
      {
        id: 'alerting-fires',
        question: 'Why has no alert ever fired?',
        answer:
          'Because nothing feeds findings into Cerberus yet. Rules and policies are stored and ready, but no scanner is connected, so there is nothing for a rule to judge. Set them up now and they run the day ingestion lands.',
        state: 'partial',
        keywords: ['not firing', 'no alerts', 'nothing happens', 'broken'],
      },
    ],
  },
  {
    id: 'scheduled',
    title: 'Scheduled',
    blurb: 'Standing instructions that run on a timer.',
    entries: [
      {
        id: 'scheduled-what',
        question: 'What is a schedule?',
        answer:
          'A standing instruction: do this thing, again and again, on a timer. Cerberus works out when it runs next and does it without you.',
        points: [
          'Remind me: a nudge about something you do often, such as inbox triage.',
          'Create a task: makes a real task in Tasks for somebody to pick up.',
          'Run a report and Run a scan: stored, but their engines do not exist yet.',
        ],
        to: '/scheduled',
        state: 'live',
        keywords: ['schedule', 'recurring', 'repeat', 'reminder', 'cron', 'timer'],
      },
      {
        id: 'scheduled-timing',
        question: 'How do I set when it runs?',
        answer:
          'Pick daily, weekly, or monthly, then fill in the detail. The form writes your choice back as a sentence and shows the first run before you save, so you can check it. That preview uses the same rule the runner uses, so what it promises is what happens.',
        points: [
          'Times are in UTC, not your local time.',
          'A monthly schedule set for the 31st uses the last day of a short month.',
          'A weekly schedule needs at least one day chosen, or it can never fire.',
        ],
        state: 'live',
        keywords: ['recurrence', 'weekly', 'monthly', 'daily', 'time', 'utc', 'when'],
      },
      {
        id: 'scheduled-notify',
        question: 'Where does the result of a run go?',
        answer:
          'Always to the bell, whatever else happens. If the schedule names a contact point, the result also goes out to every integration on it. The bell is written first, so a person always has one place to look even when every channel is down.',
        points: ['Pick a contact point under Tell somebody in the schedule form.'],
        state: 'live',
        keywords: ['notification', 'slack', 'bell', 'delivery', 'contact point'],
      },
      {
        id: 'scheduled-edit',
        question: 'Can I change a schedule after making it?',
        answer:
          'Yes. Press Edit on the row. Changing the timing works out a fresh next run, and the run history stays. Renaming it leaves the next run exactly where it was.',
        points: [
          'Pause stops it without losing anything. Resume works out a fresh next run.',
          'A paused schedule never fires a backlog when it wakes.',
          'Run now fires it immediately, without waiting for its time.',
        ],
        state: 'live',
        keywords: ['edit', 'change', 'pause', 'resume', 'delete', 'run now'],
      },
    ],
  },
  {
    id: 'tasks',
    title: 'Tasks and Projects',
    blurb: 'Tracking the work, and the structure it sits in.',
    entries: [
      {
        id: 'tasks-what',
        question: 'How does Tasks work?',
        answer:
          'A task belongs to the workspace and carries a reference such as TSK-14. Open one and you get its detail beside a timeline that mixes comments with events, so the whole story reads from top to bottom.',
        points: [
          'Thirteen statuses, grouped into five categories so the list stays readable.',
          'Filter by status, assignee, or priority. The filters run on the server.',
          'Archive hides a task without destroying it. Restore brings it back.',
        ],
        to: '/tasks',
        state: 'live',
        keywords: ['task', 'status', 'assignee', 'priority', 'comment', 'archive'],
      },
      {
        id: 'tasks-projects',
        question: 'What is the difference between Tasks and Projects?',
        answer:
          'They are separate on purpose. Projects holds the shape of the work: projects, folders, and lists. Tasks holds the work itself. You never have to open Projects to make a task.',
        points: ['Tasks is for organization accounts. Projects is for both.'],
        to: '/projects',
        state: 'live',
        keywords: ['project', 'folder', 'list', 'difference', 'structure'],
      },
      {
        id: 'tasks-statuses',
        question: 'Why are there so many statuses?',
        answer:
          'Because real work has more than two states. To keep that readable, every status belongs to a category: Not started, Active, Blocked, Done, or Closed. The list groups by category, so you see where things stand without reading thirteen headings.',
        state: 'live',
        keywords: ['status', 'category', 'blocked', 'backlog', 'qa'],
      },
    ],
  },
  {
    id: 'people',
    title: 'People and access',
    blurb: 'Who is in the workspace, and what each of them may do.',
    entries: [
      {
        id: 'roles',
        question: 'What can each role do?',
        answer:
          'There are four. An owner runs the workspace and holds billing. An admin runs the day to day. A member does the work. A viewer reads and nothing else.',
        points: [
          'Only an owner can delete the workspace or change billing.',
          'A viewer can never change anything, in any kind of workspace.',
          'In a personal workspace everybody works at the owner level.',
        ],
        to: '/workspace',
        state: 'live',
        keywords: ['role', 'owner', 'admin', 'member', 'viewer', 'permission', 'access'],
      },
      {
        id: 'policy',
        question: 'How do I control what members can do?',
        answer:
          'Open Settings and use the membership switches. They decide whether a plain member may invite others, create projects, and manage alerts. An owner and an admin ignore the switches, and a personal workspace ignores them too, because it is flat.',
        to: '/settings',
        state: 'live',
        keywords: ['policy', 'switches', 'members', 'invite', 'restrict', 'settings'],
      },
      {
        id: 'hidden',
        question: 'Why can I not see a module somebody else has?',
        answer:
          'Some modules belong to one kind of account. Tasks and Audit are for organizations. Knowledge base is for personal accounts. Hiding it in the rail is never the only gate, so the address bar will not get you in either.',
        keywords: ['missing', 'cannot see', 'hidden', 'module', 'access'],
      },
    ],
  },
  {
    id: 'account',
    title: 'Your account',
    blurb: 'Your details, and how Cerberus keeps them.',
    entries: [
      {
        id: 'profile',
        question: 'How do I change my name, picture, or password?',
        answer:
          'Open Your profile from the account menu. Your picture is cropped in the browser before it is sent, so only the square you chose ever leaves your machine. Changing your email or password asks for your current password first.',
        to: '/profile',
        state: 'live',
        keywords: ['profile', 'picture', 'avatar', 'password', 'email', 'name'],
      },
      {
        id: 'security',
        question: 'How does Cerberus keep my password and session?',
        answer:
          'Your password is hashed with Argon2id, which is the current recommendation, and the plain text is never stored. Your session is a random token in a cookie the browser cannot read from JavaScript, and the database keeps only a hash of it. Somebody reading the sessions table still cannot sign in as you.',
        points: ['Signing out removes the session at once, rather than waiting for it to expire.'],
        keywords: ['security', 'password', 'session', 'cookie', 'argon2', 'safe', 'privacy'],
      },
      {
        id: 'bell',
        question: 'What is in the bell?',
        answer:
          'Two things, kept apart. Activity is what Cerberus did in your workspace, such as a schedule running. What is new is news from Cerberus itself, such as a new module or an offer. Keeping them apart means an offer never buries a real failure.',
        state: 'live',
        keywords: ['bell', 'notification', 'news', 'updates', 'announcement'],
      },
    ],
  },
  {
    id: 'coming',
    title: 'Not built yet',
    blurb: 'Modules you can see in the rail that do not do anything so far.',
    entries: [
      {
        id: 'placeholders',
        question: 'Which modules are still empty?',
        answer:
          'Issues, Assets, Integrations, Inbox, and Knowledge base show a placeholder card. They are in the rail so the shape of the product is clear, and each will fill in.',
        points: [
          'Issues: the findings queue, where a finding can spawn a task.',
          'Assets: everything Cerberus watches.',
          'Integrations: the scanners, clouds, and repositories that feed it.',
          'Inbox: talking to the people you work with.',
          'Knowledge base: a learning path through security basics.',
        ],
        state: 'planned',
        keywords: ['empty', 'placeholder', 'coming soon', 'issues', 'assets', 'inbox'],
      },
      {
        id: 'mock',
        question: 'Are the numbers on the Dashboard real?',
        answer:
          'No. Dashboard, Reporting, and Audit are built, but they run on placeholder data. They become real when findings start arriving.',
        state: 'partial',
        keywords: ['dashboard', 'fake', 'placeholder', 'numbers', 'reporting', 'audit'],
      },
    ],
  },
];

/** Everything in one list, for searching. */
export const ALL_ENTRIES: Array<HelpEntry & { section: string }> = HELP.flatMap((section) =>
  section.entries.map((entry) => ({ ...entry, section: section.title })),
);

/** Matches a query against the question, the answer, and the keywords. */
export function searchHelp(query: string): Array<HelpEntry & { section: string }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const words = needle.split(/\s+/).filter(Boolean);

  return ALL_ENTRIES.filter((entry) => {
    const hay = [entry.question, entry.answer, ...(entry.points ?? []), ...(entry.keywords ?? [])]
      .join(' ')
      .toLowerCase();
    // Every word must appear somewhere, so a longer query narrows the list.
    return words.every((word) => hay.includes(word));
  });
}

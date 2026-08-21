import {
  BellRing,
  Boxes,
  Building2,
  CalendarClock,
  CircleUser,
  FileBarChart,
  FolderKanban,
  Gauge,
  GraduationCap,
  LifeBuoy,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Plug,
  Route,
  ScrollText,
  Send,
  Settings,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

/**
 * The one map of the workspace.
 *
 * The sidebar renders it, the router builds routes from it, and the top bar
 * reads the title and the subtitle from it. Add a module here and all three
 * follow. An item with orgOnly stays hidden from a personal account, and one
 * with personalOnly stays hidden from an organization. The router sends the
 * wrong account back to the dashboard, so hiding it is never the only gate.
 */

export type NavItem = {
  to: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
  badge?: number;
  orgOnly?: boolean;
  personalOnly?: boolean;
};

export type NavGroup = {
  label?: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      {
        to: '/dashboard',
        label: 'Dashboard',
        subtitle: 'Where your risk sits right now.',
        icon: LayoutDashboard,
      },
      {
        to: '/scheduled',
        label: 'Scheduled',
        subtitle: 'Scans and jobs that run on a timer.',
        icon: CalendarClock,
      },
    ],
  },
  {
    label: 'Monitor',
    items: [
      {
        to: '/issues',
        label: 'Issues',
        subtitle: 'Triage the queue.',
        icon: ShieldAlert,
        badge: 37,
      },
      {
        to: '/alerting',
        label: 'Alerting',
        subtitle: 'Rules that decide what wakes somebody up.',
        icon: BellRing,
      },
      {
        to: '/assets',
        label: 'Assets',
        subtitle: 'Everything Cerberus watches.',
        icon: Boxes,
      },
      {
        to: '/integrations',
        label: 'Integrations',
        subtitle: 'Scanners, clouds, and repositories.',
        icon: Plug,
      },
    ],
  },
  {
    label: 'Work',
    items: [
      {
        to: '/workspace',
        label: 'Workspace',
        subtitle: 'Members, teams, and roles.',
        icon: Building2,
      },
      {
        to: '/projects',
        label: 'Projects',
        subtitle: 'Group your assets by the work they support.',
        icon: FolderKanban,
      },
      {
        to: '/tasks',
        label: 'Tasks',
        subtitle: 'Track the remediation work your team owns.',
        icon: ListChecks,
        orgOnly: true,
      },
      {
        to: '/inbox',
        label: 'Inbox',
        subtitle: 'Talk to the people you work with.',
        icon: Inbox,
      },
      {
        to: '/knowledge-base',
        label: 'Knowledge base',
        subtitle: 'Learn the ground you are defending.',
        icon: GraduationCap,
        personalOnly: true,
      },
    ],
  },
  {
    label: 'Records',
    items: [
      {
        to: '/reporting',
        label: 'Reporting',
        subtitle: 'Scheduled evidence for auditors and leadership.',
        icon: FileBarChart,
      },
      {
        to: '/audit',
        label: 'Audit',
        subtitle: 'Every privileged action in the workspace.',
        icon: ScrollText,
        orgOnly: true,
      },
    ],
  },
];

export const FOOTER_ITEMS: NavItem[] = [
  {
    to: '/settings',
    label: 'Settings',
    subtitle: 'Policy, tokens, and preferences.',
    icon: Settings,
  },
  {
    to: '/help',
    label: 'Help',
    subtitle: 'What Cerberus does, and how each part of it works.',
    icon: LifeBuoy,
  },
];

/**
 * Pages the sidebar does not list. The profile is reached from the account
 * menu, so it needs a route and a title but no rail entry.
 */
export const HIDDEN_ITEMS: NavItem[] = [
  {
    to: '/profile',
    label: 'Your profile',
    subtitle: 'Your name, your mark, and your sign-in details.',
    icon: CircleUser,
  },
  {
    to: '/usage',
    label: 'Usage and plan',
    subtitle: 'What your workspace consumes, and what it costs.',
    icon: Gauge,
  },
  {
    to: '/alerting/rules',
    label: 'Alert rules',
    subtitle: 'Decide what is worth waking somebody about.',
    icon: BellRing,
  },
  {
    to: '/alerting/contact-points',
    label: 'Contact points',
    subtitle: 'Decide how a person hears about it.',
    icon: Send,
  },
  {
    to: '/alerting/policies',
    label: 'Notification policies',
    subtitle: 'Decide which alert reaches which contact point.',
    icon: Route,
  },
];

/** Every routable page. The router builds one route for each. */
export const ALL_ITEMS: NavItem[] = [
  ...NAV_GROUPS.flatMap((group) => group.items),
  ...FOOTER_ITEMS,
  ...HIDDEN_ITEMS,
];

export function findItem(pathname: string): NavItem | undefined {
  return ALL_ITEMS.find((item) => item.to === pathname);
}

/** Drops the modules that do not belong to this kind of account. */
export function visibleGroups(organization: boolean): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => (organization ? !item.personalOnly : !item.orgOnly)),
  })).filter((group) => group.items.length > 0);
}

/** Shared contracts and the built-in beginner path for the knowledge base. */

export const KNOWLEDGE_TOPICS = [
  { id: 'foundations', label: 'Security foundations', description: 'Learn the language, goals, and common risks.' },
  { id: 'networking', label: 'Networking', description: 'See how systems connect and where traffic can fail.' },
  { id: 'identity', label: 'Identity and people', description: 'Protect accounts and spot attacks that target people.' },
  { id: 'defense', label: 'Defense and response', description: 'Use controls, logs, and a clear response process.' },
] as const;

export type KnowledgeTopic = (typeof KNOWLEDGE_TOPICS)[number]['id'];
export type KnowledgeLessonType = 'article' | 'video';

export type KnowledgeSection = {
  heading: string;
  paragraphs: string[];
  points?: string[];
};

export type BuiltInKnowledgeLesson = {
  key: string;
  topic: KnowledgeTopic;
  title: string;
  summary: string;
  type: KnowledgeLessonType;
  durationMinutes: number;
  sections: KnowledgeSection[];
  videoId?: string;
  sourceLabel?: string;
};

export type KnowledgeResource = {
  id: string;
  topic: KnowledgeTopic;
  title: string;
  summary: string;
  type: KnowledgeLessonType;
  body: string;
  sourceUrl: string | null;
  videoId: string | null;
  durationMinutes: number;
  published: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SaveKnowledgeResourceRequest = {
  topic: KnowledgeTopic;
  title: string;
  summary: string;
  type: KnowledgeLessonType;
  body?: string;
  sourceUrl?: string;
  durationMinutes: number;
  published: boolean;
};

export type KnowledgePayload = {
  resources: KnowledgeResource[];
  completedLessonKeys: string[];
  canPublish: boolean;
};

export const BUILT_IN_KNOWLEDGE_LESSONS: BuiltInKnowledgeLesson[] = [
  {
    key: 'foundations-what-is-cybersecurity',
    topic: 'foundations',
    title: 'What cybersecurity protects',
    summary: 'Learn what cybersecurity covers and why every connected system needs protection.',
    type: 'video',
    durationMinutes: 14,
    videoId: '_DVVNOGYtmU',
    sourceLabel: 'Google Career Certificates',
    sections: [
      {
        heading: 'Start with the purpose',
        paragraphs: [
          'Cybersecurity protects systems, networks, applications, and data from harmful actions.',
          'Good security supports the business. It helps people use technology with less risk.',
        ],
        points: ['Protect important data.', 'Keep services available.', 'Find unusual activity early.', 'Recover with a clear plan.'],
      },
    ],
  },
  {
    key: 'foundations-cia-triad',
    topic: 'foundations',
    title: 'The CIA triad',
    summary: 'Use confidentiality, integrity, and availability to describe a security goal.',
    type: 'article',
    durationMinutes: 6,
    sections: [
      {
        heading: 'Confidentiality',
        paragraphs: ['Only approved people and systems should read protected information.'],
        points: ['Use access controls.', 'Encrypt sensitive data.', 'Share only what a person needs.'],
      },
      {
        heading: 'Integrity',
        paragraphs: ['Information should stay correct, complete, and protected from unauthorized changes.'],
        points: ['Validate input.', 'Keep an audit trail.', 'Use hashes and digital signatures.'],
      },
      {
        heading: 'Availability',
        paragraphs: ['Approved users should reach systems and data when they need them.'],
        points: ['Monitor service health.', 'Plan for failure.', 'Test backups and recovery.'],
      },
    ],
  },
  {
    key: 'foundations-threat-risk-control',
    topic: 'foundations',
    title: 'Threats, risks, and controls',
    summary: 'Separate these terms so you can explain and prioritize a security problem.',
    type: 'article',
    durationMinutes: 7,
    sections: [
      {
        heading: 'Use the right term',
        paragraphs: [
          'A threat can cause harm. A vulnerability is a weakness that a threat can use.',
          'Risk combines the chance of harm with its impact. A control reduces that risk.',
        ],
      },
      {
        heading: 'A simple example',
        paragraphs: ['A stolen password is a threat. Missing MFA is a weakness. MFA is a control.'],
        points: ['Find the asset.', 'Describe the threat.', 'Confirm the weakness.', 'Choose a control.', 'Check the remaining risk.'],
      },
    ],
  },
  {
    key: 'networking-how-networks-work',
    topic: 'networking',
    title: 'How networks move data',
    summary: 'Follow data through devices, addresses, and protocols.',
    type: 'video',
    durationMinutes: 12,
    videoId: 'u8AYAr0Fus8',
    sourceLabel: 'Learn with Cisco',
    sections: [
      {
        heading: 'Watch the path',
        paragraphs: ['A network moves data between devices. Protocols define how those devices communicate.'],
        points: ['A switch connects local devices.', 'A router connects different networks.', 'An IP address identifies a network location.'],
      },
    ],
  },
  {
    key: 'networking-ip-dns-ports',
    topic: 'networking',
    title: 'IP addresses, DNS, and ports',
    summary: 'Learn the three labels that guide most network traffic.',
    type: 'article',
    durationMinutes: 8,
    sections: [
      {
        heading: 'Find the destination',
        paragraphs: [
          'An IP address identifies a host on a network. DNS maps a readable name to an address.',
          'A port identifies the service that should receive the connection on that host.',
        ],
      },
      {
        heading: 'Common ports',
        paragraphs: ['Port numbers help a defender understand expected and unexpected traffic.'],
        points: ['22: SSH', '53: DNS', '80: HTTP', '443: HTTPS', '5432: PostgreSQL'],
      },
    ],
  },
  {
    key: 'networking-firewalls-segmentation',
    topic: 'networking',
    title: 'Firewalls and segmentation',
    summary: 'Control traffic and reduce how far an attacker can move.',
    type: 'article',
    durationMinutes: 7,
    sections: [
      {
        heading: 'Control each path',
        paragraphs: [
          'A firewall allows or blocks traffic through defined rules.',
          'Segmentation separates systems into zones. It limits movement after one system fails.',
        ],
        points: ['Allow only required traffic.', 'Review old rules.', 'Separate public services from private data.', 'Log blocked connections.'],
      },
    ],
  },
  {
    key: 'identity-passwords-mfa',
    topic: 'identity',
    title: 'Passwords and MFA',
    summary: 'Build account protection that survives one stolen password.',
    type: 'article',
    durationMinutes: 7,
    sections: [
      {
        heading: 'Use layers',
        paragraphs: ['Use a unique password for each service. Store passwords in a trusted password manager.'],
        points: ['Use long generated passwords.', 'Enable MFA.', 'Prefer passkeys or security keys.', 'Remove unused accounts.'],
      },
      {
        heading: 'MFA matters',
        paragraphs: ['MFA asks for another proof. A stolen password alone is then less useful.'],
      },
    ],
  },
  {
    key: 'identity-phishing',
    topic: 'identity',
    title: 'Recognize and report phishing',
    summary: 'Spot urgent requests, false links, and unusual account prompts.',
    type: 'video',
    durationMinutes: 5,
    videoId: 'fow7C_0EoRs',
    sourceLabel: 'CISA',
    sections: [
      {
        heading: 'Pause before you act',
        paragraphs: ['Phishing uses trust, fear, or urgency to make a person act without checking.'],
        points: ['Check the sender.', 'Open links only after you inspect them.', 'Confirm unusual requests another way.', 'Report the message.'],
      },
    ],
  },
  {
    key: 'identity-least-privilege',
    topic: 'identity',
    title: 'Least privilege',
    summary: 'Give each identity only the access required for its current work.',
    type: 'article',
    durationMinutes: 6,
    sections: [
      {
        heading: 'Reduce unnecessary access',
        paragraphs: ['Broad access increases the damage from mistakes and stolen accounts.'],
        points: ['Start with no access.', 'Grant a defined role.', 'Set an end time when possible.', 'Review access often.'],
      },
    ],
  },
  {
    key: 'defense-web-application-risk',
    topic: 'defense',
    title: 'Web application risk',
    summary: 'Meet the common risks that affect web applications and APIs.',
    type: 'video',
    durationMinutes: 18,
    videoId: 'yGOXewm3DsA',
    sourceLabel: 'OWASP Foundation',
    sections: [
      {
        heading: 'Use a common baseline',
        paragraphs: ['The OWASP Top 10 helps teams discuss important web application risks.'],
        points: ['Check access control.', 'Protect secrets and data.', 'Validate input.', 'Keep dependencies current.', 'Record security events.'],
      },
    ],
  },
  {
    key: 'defense-logging-monitoring',
    topic: 'defense',
    title: 'Logging and monitoring',
    summary: 'Collect useful signals and turn them into action.',
    type: 'article',
    durationMinutes: 8,
    sections: [
      {
        heading: 'Record useful events',
        paragraphs: ['A useful log says what happened, when it happened, and which identity caused it.'],
        points: ['Record sign-in failures.', 'Record permission changes.', 'Record sensitive data access.', 'Protect logs from changes.'],
      },
      {
        heading: 'Create actionable alerts',
        paragraphs: ['An alert should name the affected service, the risk, and the next action.'],
      },
    ],
  },
  {
    key: 'defense-incident-response',
    topic: 'defense',
    title: 'Incident response basics',
    summary: 'Use a repeatable process when a security event becomes an incident.',
    type: 'article',
    durationMinutes: 9,
    sections: [
      {
        heading: 'Follow the response cycle',
        paragraphs: ['Preparation makes every later step faster and more reliable.'],
        points: ['Prepare.', 'Detect and analyze.', 'Contain the incident.', 'Remove the cause.', 'Recover safely.', 'Record lessons.'],
      },
      {
        heading: 'Keep evidence',
        paragraphs: ['Record times, actions, owners, and decisions. Preserve evidence before you change affected systems.'],
      },
    ],
  },
];

export const BUILT_IN_LESSON_KEYS = new Set(BUILT_IN_KNOWLEDGE_LESSONS.map((lesson) => lesson.key));

/** Extracts a safe YouTube video identifier from common link formats. */
export function youtubeVideoId(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let candidate: string | null = null;

  if (host === 'youtu.be') candidate = url.pathname.split('/').filter(Boolean)[0] ?? null;
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    candidate = url.searchParams.get('v');
    if (!candidate) {
      const parts = url.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(parts[0] ?? '')) candidate = parts[1] ?? null;
    }
  }

  return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

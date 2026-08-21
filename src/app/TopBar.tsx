import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import {
  Bell as BellIcon,
  ChevronDown,
  ChevronLeft,
  CircleUser,
  Command,
  Gauge,
  KeyRound,
  Keyboard,
  LogOut,
  Search,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import {
  avatarUrl,
  listNotifications,
  markAnnouncementsRead,
  markNotificationsRead,
  type Announcement,
  type AppNotification,
} from './api';
import { initials, type Session } from './session';

type MenuItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Where the item goes. An item with no route does nothing yet. */
  to?: string;
  hint?: string;
  danger?: boolean;
};

/** The mark, as a picture when there is one and as letters when there is not. */
function Avatar({ session, large }: { session: Session; large?: boolean }) {
  const url = avatarUrl(session.user);
  const size = large ? 40 : 28;
  const className = large ? 'avatar lg' : 'avatar';

  if (url) return <img className={className} src={url} alt="" width={size} height={size} />;

  return (
    <span className={className} aria-hidden="true">
      {initials(session)}
    </span>
  );
}

/**
 * The account menu.
 *
 * It holds what belongs to the person and to the account, not what the
 * sidebar already carries. Settings and Workspace live in the rail, so
 * repeating them here would give one thing two doors.
 */
const MENU: MenuItem[][] = [
  [
    { id: 'profile', label: 'Your profile', icon: CircleUser, to: '/profile' },
    { id: 'usage', label: 'Usage and plan', icon: Gauge, to: '/usage' },
  ],
  [
    { id: 'tokens', label: 'API keys and tokens', icon: KeyRound, to: '/settings' },
    { id: 'invite', label: 'Invite teammates', icon: UserPlus, to: '/workspace' },
  ],
  [{ id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, hint: '?' }],
  [{ id: 'logout', label: 'Log out', icon: LogOut, danger: true }],
];

/**
 * Whether going back stays inside Cerberus.
 *
 * window.history.length counts entries from before the app loaded, so it says
 * yes when back would leave the workspace. Counting our own pushes and pops is
 * the only answer that holds.
 */
function useCanGoBack(): boolean {
  const navigationType = useNavigationType();
  const location = useLocation();
  const depth = useRef(0);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    if (navigationType === 'PUSH') depth.current += 1;
    else if (navigationType === 'POP') depth.current = Math.max(0, depth.current - 1);
    setCanGoBack(depth.current > 0);
  }, [location.key, navigationType]);

  return canGoBack;
}

/** How long ago, in the fewest words that stay true. */
function ago(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** What the bell separates: this workspace's activity, and news from Cerberus. */
type BellTab = 'activity' | 'news';

const ANNOUNCEMENT_LABEL: Record<Announcement['kind'], string> = {
  update: 'Update',
  promotion: 'Offer',
  notice: 'Notice',
};

/** The bell. Polls quietly, because nothing pushes to the browser yet. */
function Bell() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<BellTab>('activity');
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [news, setNews] = useState<Announcement[]>([]);
  const [unread, setUnread] = useState(0);
  const [unreadNews, setUnreadNews] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const result = await listNotifications();
      setRows(result.notifications);
      setNews(result.announcements);
      setUnread(result.unread);
      setUnreadNews(result.unreadNews);
    } catch {
      // A failed poll is not worth telling anybody about.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 45000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Opening on the tab that has something new saves a click.
  function toggle() {
    setOpen((value) => {
      if (!value && unread === 0 && unreadNews > 0) setTab('news');
      else if (!value && unread > 0) setTab('activity');
      return !value;
    });
  }

  async function follow(href: string | null) {
    await load();
    if (href) {
      setOpen(false);
      navigate(href);
    }
  }

  const total = unread + unreadNews;

  return (
    <div className="bell" ref={boxRef}>
      <button
        type="button"
        className="icon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={total > 0 ? `Notifications, ${total} unread` : 'Notifications'}
        onClick={toggle}
      >
        <BellIcon size={18} aria-hidden="true" />
        {total > 0 && <span className="dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="bell-panel" role="menu">
          <div className="bell-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'activity'}
              className={tab === 'activity' ? 'bell-tab on' : 'bell-tab'}
              onClick={() => setTab('activity')}
            >
              Activity
              {unread > 0 && <span className="bell-count">{unread}</span>}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'news'}
              className={tab === 'news' ? 'bell-tab on' : 'bell-tab'}
              onClick={() => setTab('news')}
            >
              What is new
              {unreadNews > 0 && <span className="bell-count">{unreadNews}</span>}
            </button>
          </div>

          {tab === 'activity' ? (
            <>
              {unread > 0 && (
                <div className="bell-head">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={async () => {
                      await markNotificationsRead();
                      await load();
                    }}
                  >
                    Mark all read
                  </button>
                </div>
              )}

              {rows.length === 0 ? (
                <p className="bell-empty">Nothing yet. Anything Cerberus does for you lands here.</p>
              ) : (
                <ul className="bell-list">
                  {rows.map((row) => (
                    <li key={row.id} className={row.read ? 'bell-item' : 'bell-item new'}>
                      <button
                        type="button"
                        onClick={async () => {
                          await markNotificationsRead(row.id);
                          await follow(row.href);
                        }}
                      >
                        <span className="bell-source">{row.source}</span>
                        <strong>{row.title}</strong>
                        {row.body && <small>{row.body}</small>}
                        <time>{ago(row.createdAt)}</time>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              {unreadNews > 0 && (
                <div className="bell-head">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={async () => {
                      await markAnnouncementsRead();
                      await load();
                    }}
                  >
                    Mark all read
                  </button>
                </div>
              )}

              {news.length === 0 ? (
                <p className="bell-empty">No news yet. Product updates and offers land here.</p>
              ) : (
                <ul className="bell-list">
                  {news.map((row) => (
                    <li key={row.id} className={row.read ? 'bell-item' : 'bell-item new'}>
                      <button
                        type="button"
                        onClick={async () => {
                          await markAnnouncementsRead(row.id);
                          await follow(row.href);
                        }}
                      >
                        <span className={`bell-source kind-${row.kind}`}>{ANNOUNCEMENT_LABEL[row.kind]}</span>
                        <strong>{row.title}</strong>
                        {row.body && <small>{row.body}</small>}
                        <time>{ago(row.publishedAt)}</time>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

type Props = {
  title: string;
  subtitle: string;
  session: Session;
  onLogout: () => void;
};

export default function TopBar({ title, subtitle, session, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const plan = session.organization.kind === 'organization' ? 'Organization' : 'Personal';

  // Close on outside click and on Escape. A menu that traps the user is worse
  // than no menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <header className="topbar">
      <button
        type="button"
        className="topbar-back"
        onClick={() => navigate(-1)}
        disabled={!canGoBack}
        aria-label="Go back"
        title={canGoBack ? 'Go back' : 'Nothing to go back to'}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>

      <div className="topbar-title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <div className="topbar-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" placeholder="Search findings, assets, policies" aria-label="Search" />
        <kbd>
          <Command size={11} aria-hidden="true" />K
        </kbd>
      </div>

      <div className="topbar-actions">
        <Bell />
        <div className="profile-menu" ref={menuRef}>
          <button
            type="button"
            className="profile-trigger"
            aria-haspopup="menu"
            aria-expanded={open}
            // The button holds no text, so the name becomes its label.
            aria-label={`Account menu for ${session.user.fullName}`}
            onClick={() => setOpen((v) => !v)}
          >
            <Avatar session={session} />
            <ChevronDown size={15} aria-hidden="true" />
          </button>

          {open && (
            <div className="menu-panel" role="menu">
              <div className="menu-head">
                <Avatar session={session} large />
                <div>
                  <strong>{session.user.fullName}</strong>
                  <small>{session.user.email}</small>
                  <span className="plan-chip">{plan}</span>
                </div>
              </div>

              {MENU.map((group, index) => (
                <div className="menu-group" key={index}>
                  {group.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        className={item.danger ? 'menu-item danger' : 'menu-item'}
                        onClick={() => {
                          setOpen(false);
                          if (item.id === 'logout') onLogout();
                          else if (item.to) navigate(item.to);
                        }}
                      >
                        <Icon size={16} aria-hidden="true" />
                        <span>{item.label}</span>
                        {item.hint && <kbd>{item.hint}</kbd>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

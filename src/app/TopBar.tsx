import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Building2,
  ChevronDown,
  CircleUser,
  Command,
  KeyRound,
  Keyboard,
  LifeBuoy,
  LogOut,
  Search,
  Settings,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

type MenuItem = { id: string; label: string; icon: LucideIcon; hint?: string; danger?: boolean };

const MENU: MenuItem[][] = [
  [
    { id: 'profile', label: 'Your profile', icon: CircleUser },
    { id: 'account', label: 'Account settings', icon: Settings, hint: 'g then s' },
    { id: 'workspace', label: 'Workspace settings', icon: Building2 },
  ],
  [
    { id: 'tokens', label: 'API keys and tokens', icon: KeyRound },
    { id: 'invite', label: 'Invite teammates', icon: UserPlus },
  ],
  [
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, hint: '?' },
    { id: 'help', label: 'Help and documentation', icon: LifeBuoy },
  ],
  [{ id: 'logout', label: 'Log out', icon: LogOut, danger: true }],
];

type Props = {
  title: string;
  subtitle: string;
  onLogout: () => void;
};

export default function TopBar({ title, subtitle, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
        <button type="button" className="icon-button" aria-label="Notifications, 3 unread">
          <Bell size={18} aria-hidden="true" />
          <span className="dot" aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" aria-label="Help">
          <LifeBuoy size={18} aria-hidden="true" />
        </button>

        <div className="profile-menu" ref={menuRef}>
          <button
            type="button"
            className="profile-trigger"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="avatar" aria-hidden="true">
              OT
            </span>
            <span className="profile-name">
              <strong>Olamiposi Tehingbola</strong>
              <small>Lendsqr</small>
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>

          {open && (
            <div className="menu-panel" role="menu">
              <div className="menu-head">
                <span className="avatar lg" aria-hidden="true">
                  OT
                </span>
                <div>
                  <strong>Olamiposi Tehingbola</strong>
                  <small>oluwademilade@lendsqr.com</small>
                  <span className="plan-chip">Organization</span>
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

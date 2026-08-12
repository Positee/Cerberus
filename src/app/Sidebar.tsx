import { NavLink } from 'react-router-dom';
import {
  Boxes,
  ChevronsLeft,
  FileBarChart,
  LayoutDashboard,
  LifeBuoy,
  Plug,
  ScrollText,
  Settings,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

type Item = { to: string; label: string; icon: LucideIcon; badge?: number };

const PRIMARY: Item[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/reporting', label: 'Reporting', icon: FileBarChart },
  { to: '/audit', label: 'Audit', icon: ScrollText },
];

const SECONDARY: Item[] = [
  { to: '/findings', label: 'Findings', icon: ShieldAlert, badge: 37 },
  { to: '/assets', label: 'Assets', icon: Boxes },
  { to: '/integrations', label: 'Integrations', icon: Plug },
];

const FOOTER: Item[] = [{ to: '/settings', label: 'Settings', icon: Settings }];

type Props = {
  collapsed: boolean;
  onToggle: () => void;
};

export default function Sidebar({ collapsed, onToggle }: Props) {
  const renderGroup = (items: Item[], label?: string) => (
    <>
      {label && !collapsed && <p className="nav-group-label">{label}</p>}
      <ul className="nav-list">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) => (isActive ? 'nav-item current' : 'nav-item')}
                // The label is the accessible name when the rail is collapsed.
                title={collapsed ? item.label : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="nav-text">{item.label}</span>
                {item.badge !== undefined && (
                  <span className="nav-badge" aria-label={`${item.badge} open critical`}>
                    {item.badge}
                  </span>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </>
  );

  return (
    <nav className="sidebar" data-collapsed={collapsed} aria-label="Main">
      <NavLink to="/dashboard" className="sidebar-brand">
        <img src="/cerberus-mark.webp" alt="" width={224} height={140} />
        <span className="wordmark">Cerberus</span>
      </NavLink>

      <div className="sidebar-scroll">
        {renderGroup(PRIMARY)}
        {renderGroup(SECONDARY, 'Monitor')}
      </div>

      <div className="sidebar-foot">
        {renderGroup(FOOTER)}
        <ul className="nav-list">
          <li>
            <button type="button" className="nav-item" title={collapsed ? 'Help' : undefined}>
              <LifeBuoy size={18} aria-hidden="true" />
              <span className="nav-text">Help</span>
            </button>
          </li>
        </ul>
        <button
          type="button"
          className="collapse-toggle"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronsLeft size={16} aria-hidden="true" />
          <span className="nav-text">Collapse</span>
        </button>
      </div>
    </nav>
  );
}

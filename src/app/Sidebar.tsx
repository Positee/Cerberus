import { NavLink } from 'react-router-dom';
import { ChevronsLeft } from 'lucide-react';
import { FOOTER_ITEMS, visibleGroups, type NavGroup, type NavItem } from './nav';

type Props = {
  collapsed: boolean;
  /** True when the account is an organization. It reveals the org modules. */
  organization: boolean;
  onToggle: () => void;
};

export default function Sidebar({ collapsed, organization, onToggle }: Props) {
  const groups = visibleGroups(organization);

  const renderItem = (item: NavItem) => {
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
  };

  const renderGroup = (group: NavGroup, key: string) => (
    <div className="nav-group" key={key}>
      {group.label && !collapsed && <p className="nav-group-label">{group.label}</p>}
      <ul className="nav-list">{group.items.map(renderItem)}</ul>
    </div>
  );

  return (
    <nav className="sidebar" data-collapsed={collapsed} aria-label="Main">
      <NavLink to="/dashboard" className="sidebar-brand">
        <img src="/cerberus-mark.webp" alt="" width={224} height={140} />
        <span className="wordmark">Cerberus</span>
      </NavLink>

      <div className="sidebar-scroll">
        {groups.map((group, index) => renderGroup(group, group.label ?? `group-${index}`))}
      </div>

      <div className="sidebar-foot">
        {renderGroup({ items: FOOTER_ITEMS }, 'footer')}
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

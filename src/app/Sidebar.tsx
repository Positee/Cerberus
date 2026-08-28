import { NavLink } from 'react-router-dom';
import { ChevronsLeft } from 'lucide-react';
import { Lock } from 'lucide-react';
import { FOOTER_ITEMS, visibleGroups, type NavGroup, type NavItem } from './nav';
import { planForModule, planReaches, PLAN_LABEL, type Plan } from '../../shared/plans';

type Props = {
  collapsed: boolean;
  /** True when the account is an organization. It reveals the org modules. */
  organization: boolean;
  /** What the workspace pays for. A module above it draws a lock. */
  plan: Plan;
  onToggle: () => void;
};

export default function Sidebar({ collapsed, organization, plan, onToggle }: Props) {
  const groups = visibleGroups(organization);

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const needed = planForModule(item.to);
    const locked = !planReaches(plan, needed);

    // A locked module still links. The page behind it says what the module does
    // and what unlocks it, which is how somebody learns the feature exists.
    return (
      <li key={item.to}>
        <NavLink
          to={item.to}
          className={({ isActive }) =>
            `nav-item${isActive ? ' current' : ''}${locked ? ' locked' : ''}`
          }
          title={locked ? `${item.label} needs ${PLAN_LABEL[needed]}` : collapsed ? item.label : undefined}
        >
          <Icon size={18} aria-hidden="true" />
          <span className="nav-text">{item.label}</span>
          {locked ? (
            <Lock size={13} className="nav-lock" aria-label={`Needs ${PLAN_LABEL[needed]}`} />
          ) : (
            item.badge !== undefined && (
              <span className="nav-badge" aria-label={`${item.badge} open critical`}>
                {item.badge}
              </span>
            )
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

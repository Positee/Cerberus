import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { findItem } from './nav';
import { isOrganization, type Session } from './session';
import { useShortcuts } from './useShortcuts';
import { CREATE_ON } from './shortcuts';
import Shortcuts from '../components/Shortcuts';

const STORAGE_KEY = 'cerberus.sidebar.collapsed';

type Props = {
  session: Session;
  onLogout: () => void;
};

export default function AppShell({ session, onLogout }: Props) {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  const [showShortcuts, setShowShortcuts] = useState(false);

  /*
     The create shortcut.

     The shell cannot reach inside a page, so it raises an event on the window
     and the page listens. That keeps every page free to decide what "create"
     means without the shell holding a list of callbacks.
  */
  const onCreate = useCallback(() => {
    if (!(pathname in CREATE_ON)) return false;
    window.dispatchEvent(new CustomEvent('cerberus:create'));
    return true;
  }, [pathname]);

  useShortcuts({
    onHelp: () => setShowShortcuts((open) => !open),
    onToggleRail: () => setCollapsed((value) => !value),
    onCreate,
  });

  // The title and the subtitle come from the same map the sidebar renders.
  const item = findItem(pathname) ?? findItem('/dashboard');

  return (
    <div className="app-shell" data-collapsed={collapsed}>
      <Sidebar
        collapsed={collapsed}
        organization={isOrganization(session)}
        plan={session.organization.plan}
        onToggle={() => setCollapsed((v) => !v)}
      />
      <div className="app-main">
        <TopBar
          title={item?.label ?? 'Dashboard'}
          subtitle={item?.subtitle ?? ''}
          session={session}
          onLogout={onLogout}
          onShowShortcuts={() => setShowShortcuts(true)}
        />
        <main className="app-content">
          <Outlet />
        </main>
      </div>

      {showShortcuts && <Shortcuts onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

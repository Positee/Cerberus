import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { findItem } from './nav';
import { isOrganization, type Session } from './session';

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

  // The title and the subtitle come from the same map the sidebar renders.
  const item = findItem(pathname) ?? findItem('/dashboard');

  return (
    <div className="app-shell" data-collapsed={collapsed}>
      <Sidebar
        collapsed={collapsed}
        organization={isOrganization(session)}
        onToggle={() => setCollapsed((v) => !v)}
      />
      <div className="app-main">
        <TopBar
          title={item?.label ?? 'Dashboard'}
          subtitle={item?.subtitle ?? ''}
          session={session}
          onLogout={onLogout}
        />
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

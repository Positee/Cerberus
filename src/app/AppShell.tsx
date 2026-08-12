import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const META: Record<string, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'Where your risk sits right now.' },
  reporting: { title: 'Reporting', subtitle: 'Scheduled evidence for auditors and leadership.' },
  audit: { title: 'Audit', subtitle: 'Every privileged action in the workspace.' },
  findings: { title: 'Findings', subtitle: 'Triage the queue.' },
  assets: { title: 'Assets', subtitle: 'Everything Cerberus watches.' },
  integrations: { title: 'Integrations', subtitle: 'Scanners, clouds, and repositories.' },
  settings: { title: 'Settings', subtitle: 'Workspace, members, and policy.' },
};

const STORAGE_KEY = 'cerberus.sidebar.collapsed';

export default function AppShell({ onLogout }: { onLogout: () => void }) {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  const meta = META[pathname.replace(/^\//, '')] ?? META.dashboard;

  return (
    <div className="app-shell" data-collapsed={collapsed}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <div className="app-main">
        <TopBar title={meta.title} subtitle={meta.subtitle} onLogout={onLogout} />
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

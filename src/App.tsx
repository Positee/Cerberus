import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AuthPage from './pages/AuthPage';
import AppShell from './app/AppShell';
import Dashboard from './pages/Dashboard';
import Reporting from './pages/Reporting';
import Audit from './pages/Audit';
import Placeholder from './pages/Placeholder';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Workspace from './pages/Workspace';
import Alerting from './pages/alerting/Alerting';
import AlertRules from './pages/alerting/AlertRules';
import ContactPoints from './pages/alerting/ContactPoints';
import NotificationPolicies from './pages/alerting/NotificationPolicies';
import Tasks from './pages/tasks/Tasks';
import Projects from './pages/tasks/Projects';
import Scheduled from './pages/Scheduled';
import Help from './pages/Help';
import { ALL_ITEMS } from './app/nav';
import { isOrganization, useSession } from './app/session';

/**
 * Routes and the session guard.
 *
 * The router builds one route for each module in app/nav.ts. A module without
 * an entry below renders the placeholder card. An organization module sends a
 * personal account to the dashboard, so hiding it in the sidebar is not the
 * only gate.
 */

const PAGES: Record<string, ReactElement> = {
  '/dashboard': <Dashboard />,
  '/reporting': <Reporting />,
  '/audit': <Audit />,
};

/** Held while the first /api/auth/me call runs. It stops the gate flashing. */
function BootScreen() {
  return (
    <main className="boot-screen">
      <img src="/cerberus-mark.webp" alt="" width={224} height={140} />
      <p role="status">Waking the hound.</p>
    </main>
  );
}

export default function App() {
  const { session, ready, signIn, updateUser, updateOrganization, signOut } = useSession();
  const organization = isOrganization(session);

  if (!ready) return <BootScreen />;

  // The profile needs the live session, so it is built here rather than held
  // in the static PAGES map above.
  const pageFor = (path: string, label: string) => {
    if (!session) return PAGES[path] ?? <Placeholder title={label} />;

    if (path === '/profile') {
      return <Profile session={session} onUserChange={updateUser} onSignedOut={signOut} />;
    }
    if (path === '/settings') {
      return <Settings session={session} onOrganizationChange={updateOrganization} />;
    }
    if (path === '/workspace') {
      return <Workspace session={session} onOrganizationChange={updateOrganization} />;
    }
    if (path === '/alerting') return <Alerting />;
    if (path === '/alerting/rules') return <AlertRules session={session} />;
    if (path === '/alerting/contact-points') return <ContactPoints session={session} />;
    if (path === '/alerting/policies') return <NotificationPolicies session={session} />;
    if (path === '/tasks') return <Tasks session={session} />;
    if (path === '/projects') return <Projects session={session} />;
    if (path === '/scheduled') return <Scheduled session={session} />;
    if (path === '/help') return <Help />;

    return PAGES[path] ?? <Placeholder title={label} />;
  };

  return (
    <Routes>
      <Route
        path="/login"
        element={session ? <Navigate to="/dashboard" replace /> : <AuthPage onAuthenticated={signIn} />}
      />

      <Route
        element={session ? <AppShell session={session} onLogout={signOut} /> : <Navigate to="/login" replace />}
      >
        {ALL_ITEMS.map((item) => (
          <Route
            key={item.to}
            path={item.to}
            element={
              (item.orgOnly && !organization) || (item.personalOnly && organization) ? (
                <Navigate to="/dashboard" replace />
              ) : (
                pageFor(item.to, item.label)
              )
            }
          />
        ))}
      </Route>

      <Route path="*" element={<Navigate to={session ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
}

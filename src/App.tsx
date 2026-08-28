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
import Argus from './pages/argus/Argus';
import Inbox from './pages/inbox/Inbox';
import Help from './pages/Help';
import Invites from './pages/Invites';
import Usage from './pages/Usage';
import Locked from './pages/Locked';
import Join from './pages/Join';
import { ALL_ITEMS } from './app/nav';
import { isOrganization, useSession } from './app/session';
import { planForModule, planReaches } from '../shared/plans';

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
    if (path === '/argus') return <Argus session={session} />;
    if (path === '/inbox') return <Inbox session={session} />;
    if (path === '/audit') return <Audit session={session} />;
    if (path === '/help') return <Help />;
    if (path === '/invites') return <Invites session={session} />;
    if (path === '/usage') return <Usage session={session} />;

    return PAGES[path] ?? <Placeholder title={label} />;
  };

  return (
    <Routes>
      {/* Outside the shell. Whoever opens a link may not be signed in, and may
          belong to no workspace yet. */}
      <Route path="/join/:token" element={<Join signedIn={Boolean(session)} />} />

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
              ) : session && !planReaches(session.organization.plan, planForModule(item.to)) ? (
                <Locked label={item.label} subtitle={item.subtitle} needed={planForModule(item.to)} />
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

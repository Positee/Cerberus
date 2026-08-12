import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AuthPage from './pages/AuthPage';
import AppShell from './app/AppShell';
import Dashboard from './pages/Dashboard';
import Reporting from './pages/Reporting';
import Audit from './pages/Audit';
import Placeholder from './pages/Placeholder';

/**
 * Routes and the session guard.
 *
 * There is no backend yet, so the session is a flag in sessionStorage. It
 * survives a refresh, which is what makes the routes usable, and it clears when
 * the tab closes. Replace it with a real token when the API lands.
 */

const AUTH_KEY = 'cerberus.session';

export default function App() {
  const [authenticated, setAuthenticated] = useState(() => sessionStorage.getItem(AUTH_KEY) === '1');

  const signIn = () => {
    sessionStorage.setItem(AUTH_KEY, '1');
    setAuthenticated(true);
  };

  const signOut = () => {
    sessionStorage.removeItem(AUTH_KEY);
    setAuthenticated(false);
  };

  return (
    <Routes>
      <Route
        path="/login"
        element={authenticated ? <Navigate to="/dashboard" replace /> : <AuthPage onAuthenticated={signIn} />}
      />

      <Route element={authenticated ? <AppShell onLogout={signOut} /> : <Navigate to="/login" replace />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/reporting" element={<Reporting />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/findings" element={<Placeholder title="Findings" />} />
        <Route path="/assets" element={<Placeholder title="Assets" />} />
        <Route path="/integrations" element={<Placeholder title="Integrations" />} />
        <Route path="/settings" element={<Placeholder title="Settings" />} />
      </Route>

      <Route path="*" element={<Navigate to={authenticated ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
}

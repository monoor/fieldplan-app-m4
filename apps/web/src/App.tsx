import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authClient, can, type Me } from './api';
import { Setup } from './pages/Setup';
import { Login } from './pages/Login';
import { Projects } from './pages/Projects';
import { ProjectView } from './pages/ProjectView';
import { Catalog } from './pages/Catalog';
import { Settings } from './pages/Settings';
import { ShareView } from './pages/ShareView';

export function App() {
  return (
    <Routes>
      <Route path="/s/:token" element={<ShareView />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/login" element={<Login />} />
      <Route element={<Shell />}>
        <Route index element={<Projects />} />
        <Route path="/p/:id" element={<ProjectView />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/settings/*" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function useMe() { return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/me'), retry: false, staleTime: 60_000 }); }

/** Signed-in layout: sends people to setup or sign-in when needed. */
function Shell() {
  const loc = useLocation(), nav = useNavigate(), qc = useQueryClient();
  const status = useQuery({ queryKey: ['status'], queryFn: () => api<{ setupRequired: boolean; version: string }>('/api/status') });
  const me = useMe();
  if (status.data?.setupRequired) return <Navigate to="/setup" replace />;
  if (me.isError && !me.isFetching) return <Navigate to={'/login?next=' + encodeURIComponent(loc.pathname)} replace />;
  if (!me.data) return <div className="center muted">Loading…</div>;
  const signOut = async () => { await authClient.signOut(); qc.clear(); nav('/login'); };
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="mark" />FIELDPLAN</div>
        <nav>
          <NavLink to="/" end>Projects</NavLink>
          <NavLink to="/catalog">Catalog</NavLink>
          <NavLink to="/settings">{can(me.data, 'user:manage') ? 'Settings' : 'Account'}</NavLink>
        </nav>
        <span className="spacer" />
        <span className="muted mono small">{me.data.name} · {me.data.role}</span>
        <button className="btn sm" onClick={signOut}>Sign out</button>
      </header>
      <main><Outlet /></main>
      <footer className="muted mono small foot">Fieldplan {status.data?.version ?? ''}</footer>
    </div>
  );
}

import { useState, type FormEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { Button, ErrorNote, Field, Heading, Panel } from '../../components/ui';
import { useAuth } from '../../lib/useAuth';
import { supabase } from '../../lib/supabase';

/** Only signed-in admins see the admin pages. */
export function AdminGate({ children }: { children: ReactNode }) {
  const { session, isAdmin, loading } = useAuth();
  if (loading) return <Layout>{null}</Layout>;
  if (!session) return <Login />;
  if (!isAdmin) return <NotAdmin userId={session.user.id} email={session.user.email ?? ''} />;

  const nav = ({ isActive }: { isActive: boolean }) =>
    `hud rounded-full px-3 py-1 text-xs ${isActive ? 'bg-flame/10 text-flame glow-flame shadow-[inset_0_0_0_1px_rgba(255,30,45,0.5)]' : 'text-muted hover:text-ink'}`;
  return (
    <Layout wide>
      <div className="mb-6 flex flex-wrap items-center gap-5 border-b border-line pb-3">
        <NavLink to="/admin" end className={nav}>
          Tournaments
        </NavLink>
        <NavLink to="/admin/games" className={nav}>
          Game catalog
        </NavLink>
        <span className="flex-1" />
        <span className="text-sm text-muted">{session.user.email}</span>
        <Button variant="ghost" onClick={() => supabase.auth.signOut()}>
          Sign out
        </Button>
      </div>
      {children}
    </Layout>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
  };

  return (
    <Layout>
      <div className="mx-auto mt-10 max-w-md">
        <Heading sub="Organizers only">Admin sign in</Heading>
        <Panel>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Email">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </Field>
            <Field label="Password">
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            <ErrorNote message={error} />
            <Button disabled={busy}>Sign in</Button>
          </form>
        </Panel>
      </div>
    </Layout>
  );
}

function NotAdmin({ userId, email }: { userId: string; email: string }) {
  return (
    <Layout>
      <div className="mx-auto mt-10 max-w-lg">
        <Heading sub={email}>Not an admin</Heading>
        <Panel className="flex flex-col gap-4">
          <p>This account can't manage tournaments. Ask an admin to add it using the user id below.</p>
          <div className="text-sm text-muted">
            User id: <code className="text-ink select-all">{userId}</code>
          </div>
          <Button variant="ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </Button>
        </Panel>
      </div>
    </Layout>
  );
}

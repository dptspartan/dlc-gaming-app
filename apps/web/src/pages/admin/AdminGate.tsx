import { useState, type FormEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { Button, ErrorNote, Field, Heading, Panel } from '../../components/ui';
import { useAuth } from '../../lib/useAuth';
import { supabase } from '../../lib/supabase';

/** Only signed-in admins see the admin pages. */
export function AdminGate({ children }: { children: ReactNode }) {
  const { session, isAdmin, loading, refreshAdmin } = useAuth();
  if (loading) return <Layout>{null}</Layout>;
  if (!session) return <Login />;
  if (!isAdmin) return <NotAdmin userId={session.user.id} email={session.user.email ?? ''} onClaimed={refreshAdmin} />;

  const nav = ({ isActive }: { isActive: boolean }) =>
    `hud rounded-full px-3 py-1 text-xs ${isActive ? 'bg-pink/10 text-pink glow-pink shadow-[inset_0_0_0_1px_rgba(255,43,214,0.5)]' : 'text-muted hover:text-ink'}`;
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
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    const redirect = window.location.href.split('#')[0];
    const { error, data } =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
    setBusy(false);
    if (error) setError(error.message);
    else if (mode === 'up' && !data.session) setNote('Check your email to confirm the account, then sign in.');
  };

  return (
    <Layout>
      <div className="mx-auto mt-10 max-w-md">
        <Heading sub="Organizers only">{mode === 'in' ? 'Admin sign in' : 'Create account'}</Heading>
        <Panel>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Email">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </Field>
            <Field label="Password">
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              />
            </Field>
            <ErrorNote message={error} />
            {note && <div className="text-lime">{note}</div>}
            <Button disabled={busy}>{mode === 'in' ? 'Sign in' : 'Sign up'}</Button>
            <button type="button" className="text-sm text-muted hover:text-cyan" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
              {mode === 'in' ? 'No account yet? Create one' : 'Have an account? Sign in'}
            </button>
          </form>
        </Panel>
      </div>
    </Layout>
  );
}

function NotAdmin({ userId, email, onClaimed }: { userId: string; email: string; onClaimed: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const claim = async () => {
    setError(null);
    const { data, error } = await supabase.rpc('claim_first_admin');
    if (error) setError(error.message);
    else if (data) onClaimed();
    else setMsg('An admin already exists. Ask them to add you using the user id below.');
  };

  return (
    <Layout>
      <div className="mx-auto mt-10 max-w-lg">
        <Heading sub={email}>Not an admin yet</Heading>
        <Panel className="flex flex-col gap-4">
          <p>The first person to sign in can claim the admin role. After that, an existing admin adds new admins.</p>
          <Button onClick={claim}>Claim admin</Button>
          <ErrorNote message={error} />
          {msg && <p className="text-amber">{msg}</p>}
          <div className="text-sm text-muted">
            Your user id: <code className="text-ink select-all">{userId}</code>
          </div>
          <Button variant="ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </Button>
        </Panel>
      </div>
    </Layout>
  );
}

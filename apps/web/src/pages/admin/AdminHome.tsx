import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Tournament } from '@dlc/core';
import { Button, Empty, ErrorNote, Field, Heading, Panel, StatusPill } from '../../components/ui';
import { slugify } from '../../lib/admin';
import { must, supabase } from '../../lib/supabase';

const today = () => new Date().toISOString().slice(0, 10);
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function AdminHome() {
  const [list, setList] = useState<Tournament[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    supabase
      .from('tournaments')
      .select('*')
      .order('start_date', { ascending: false })
      .then((r) => setList(must(r) as Tournament[]))
      .then(undefined, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
      <div>
        <Heading>Tournaments</Heading>
        <ErrorNote message={error} />
        {list.length === 0 && <Empty>No tournaments yet. Create one to get started.</Empty>}
        <div className="flex flex-col gap-3">
          {list.map((t) => (
            <Link key={t.id} to={`/admin/t/${t.id}`} className="panel flex items-center justify-between gap-4 hover:border-cyan">
              <div>
                <div className="font-display font-bold">{t.name}</div>
                <div className="text-sm text-muted">
                  {t.start_date} · {t.days} day{t.days > 1 ? 's' : ''} · {t.daily_start.slice(0, 5)}–{t.daily_end.slice(0, 5)} · /{t.slug}
                </div>
              </div>
              <StatusPill status={t.status} />
            </Link>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-8">
        <CreateTournament />
        <Admins />
      </div>
    </div>
  );
}

function CreateTournament() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    slug: '',
    start_date: today(),
    days: 1,
    daily_start: '10:00',
    daily_end: '20:00',
    timezone: localZone,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const { data, error } = await supabase
      .from('tournaments')
      .insert({ ...form, slug: form.slug || slugify(form.name) })
      .select()
      .single();
    if (error) setError(error.message);
    else navigate(`/admin/t/${data.id}`);
  };

  return (
    <Panel>
      <div className="hud mb-4 text-sm text-pink glow-pink">New tournament</div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Name">
          <input required value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="DLC Tournament 1" />
        </Field>
        <Field label="Link name" hint={`Public page: /t/${form.slug || slugify(form.name) || '...'}`}>
          <input value={form.slug} onChange={(e) => set({ slug: slugify(e.target.value) })} placeholder={slugify(form.name)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <input type="date" required value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} />
          </Field>
          <Field label="Days">
            <input type="number" min={1} max={60} required value={form.days} onChange={(e) => set({ days: Number(e.target.value) })} />
          </Field>
          <Field label="Daily start">
            <input type="time" required value={form.daily_start} onChange={(e) => set({ daily_start: e.target.value })} />
          </Field>
          <Field label="Daily end">
            <input type="time" required value={form.daily_end} onChange={(e) => set({ daily_end: e.target.value })} />
          </Field>
        </div>
        <Field label="Time zone">
          <input required value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} />
        </Field>
        <ErrorNote message={error} />
        <Button>Create</Button>
      </form>
    </Panel>
  );
}

function Admins() {
  const [rows, setRows] = useState<{ user_id: string }[]>([]);
  const [newId, setNewId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    supabase
      .from('admins')
      .select('user_id')
      .then((r) => setRows(must(r) as { user_id: string }[]));
  }, []);
  useEffect(load, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.from('admins').insert({ user_id: newId.trim() });
    if (error) setError(error.message);
    else {
      setNewId('');
      load();
    }
  };

  return (
    <Panel>
      <div className="hud mb-2 text-sm text-pink glow-pink">Admins</div>
      <p className="mb-3 text-sm text-muted">New organizers sign up on the admin page, then share the user id it shows them.</p>
      <ul className="mb-3 text-sm">
        {rows.map((r) => (
          <li key={r.user_id} className="truncate font-mono text-xs text-muted">
            {r.user_id}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <input className="min-w-0 flex-1" required value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="User id" />
        <Button>Add</Button>
      </form>
      <ErrorNote message={error} />
    </Panel>
  );
}

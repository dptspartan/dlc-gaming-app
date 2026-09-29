import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { findTeamConflicts, formatTime, type Match, type ScheduleResult, type Team, type Tournament, type TournamentGame } from '@dlc/core';
import { Bracket, type SlotRef } from '../../components/Bracket';
import { ScheduleList } from '../../components/ScheduleList';
import { Avatar, Button, Empty, ErrorNote, Field, Heading, Panel, StatusPill } from '../../components/ui';
import { generateFixtures, previewSchedule, reflowSchedule, swapSlots } from '../../lib/admin';
import { supabase, uploadImage } from '../../lib/supabase';
import { useLiveData, useLookups, type LiveData } from '../../lib/useLiveData';
import { MatchControl } from './MatchControl';

type Tab = 'details' | 'games' | 'fixtures';

export function TournamentEditor() {
  const { id = '' } = useParams();
  const { data, error, reload } = useLiveData({ tournamentId: id });
  const [tab, setTab] = useState<Tab>('games');
  const tournament = data.tournaments.get(id);
  if (!tournament) return error ? <ErrorNote message={error} /> : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Heading sub={<StatusPill status={tournament.status} />}>{tournament.name}</Heading>
        <div className="flex gap-2">
          <Link to={`/t/${tournament.slug}`} className="font-display rounded-lg border border-line bg-white/5 px-3 py-2 text-xs font-bold tracking-widest uppercase backdrop-blur hover:border-cyan">
            Public page
          </Link>
          <Link to={`/t/${tournament.slug}/live`} className="font-display rounded-lg border border-pink/70 bg-pink/10 px-3 py-2 text-xs font-bold tracking-widest text-pink uppercase shadow-[0_0_16px_rgba(255,43,214,0.35)]">
            Live board
          </Link>
        </div>
      </div>
      <div className="mb-6 flex gap-5 border-b border-line">
        {(
          [
            ['games', 'Games & players'],
            ['fixtures', 'Fixtures & matches'],
            ['details', 'Details'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`hud -mb-px border-b-2 pb-2 text-xs ${
              tab === k ? 'border-cyan text-cyan' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'details' && <Details tournament={tournament} onSaved={reload} />}
      {tab === 'games' && <GamesPanel tournament={tournament} data={data} onChange={reload} />}
      {tab === 'fixtures' && <FixturesPanel tournament={tournament} data={data} onChange={reload} />}
    </div>
  );
}

/* ------------------------------------------------------------------ Details */

function Details({ tournament, onSaved }: { tournament: Tournament; onSaved: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: tournament.name,
    slug: tournament.slug,
    start_date: tournament.start_date,
    days: tournament.days,
    daily_start: tournament.daily_start.slice(0, 5),
    daily_end: tournament.daily_end.slice(0, 5),
    timezone: tournament.timezone,
    status: tournament.status,
  });
  const [banner, setBanner] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<typeof form>) => {
    setSaved(false);
    setForm((f) => ({ ...f, ...patch }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const banner_url = banner ? await uploadImage(banner, 'banners') : tournament.banner_url;
      const { error } = await supabase.from('tournaments').update({ ...form, banner_url }).eq('id', tournament.id);
      if (error) throw new Error(error.message);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete ${tournament.name} with all its games, players and matches? This cannot be undone.`)) return;
    const { error } = await supabase.from('tournaments').delete().eq('id', tournament.id);
    if (error) setError(error.message);
    else navigate('/admin');
  };

  return (
    <Panel className="max-w-2xl">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input required value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Link name">
          <input required value={form.slug} onChange={(e) => set({ slug: e.target.value })} />
        </Field>
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
        <Field label="Time zone">
          <input required value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} />
        </Field>
        <Field label="Status" hint="Drafts are hidden from the public list.">
          <select value={form.status} onChange={(e) => set({ status: e.target.value as Tournament['status'] })}>
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="live">Live</option>
            <option value="finished">Finished</option>
          </select>
        </Field>
        <Field label="Banner image">
          <input type="file" accept="image/*" onChange={(e) => setBanner(e.target.files?.[0] ?? null)} />
        </Field>
        <div className="sm:col-span-2">
          <ErrorNote message={error} />
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button>Save</Button>
          {saved && <span className="text-lime">Saved</span>}
          <span className="flex-1" />
          <Button type="button" variant="danger" onClick={remove}>
            Delete tournament
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/* -------------------------------------------------------- Games & players */

function GamesPanel({ tournament, data, onChange }: { tournament: Tournament; data: LiveData; onChange: () => void }) {
  const tgames = [...data.tgames.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const available = [...data.games.values()].filter((g) => !tgames.some((tg) => tg.game_id === g.id));
  const [gameId, setGameId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const game = data.games.get(gameId);
    if (!game) return;
    const { error } = await supabase
      .from('tournament_games')
      .insert({ tournament_id: tournament.id, game_id: game.id, match_minutes: game.default_match_minutes, buffer_minutes: 5, stations: 1 });
    if (error) setError(error.message);
    else {
      setGameId('');
      onChange();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel>
        <form onSubmit={add} className="flex flex-wrap items-end gap-3">
          <Field label="Add a game to this tournament">
            <select value={gameId} onChange={(e) => setGameId(e.target.value)} className="min-w-64">
              <option value="">Choose a game…</option>
              {available.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.team_size === 1 ? 'solo' : `${g.team_size} per side`})
                </option>
              ))}
            </select>
          </Field>
          <Button disabled={!gameId}>Add game</Button>
          <Link to="/admin/games" className="text-sm text-muted hover:text-cyan">
            Manage the game catalog
          </Link>
        </form>
        <ErrorNote message={error} />
      </Panel>
      {tgames.length === 0 && <Empty>No games yet. Add one above.</Empty>}
      {tgames.map((tg) => (
        <TournamentGameCard key={tg.id} tg={tg} data={data} onChange={onChange} />
      ))}
    </div>
  );
}

function TournamentGameCard({ tg, data, onChange }: { tg: TournamentGame; data: LiveData; onChange: () => void }) {
  const game = data.games.get(tg.game_id);
  const teamSize = game?.team_size ?? 1;
  const teams = [...data.teams.values()].filter((t) => t.tournament_game_id === tg.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const hasFixtures = [...data.matches.values()].some((m) => m.tournament_game_id === tg.id);
  const [settings, setSettings] = useState({ match_minutes: tg.match_minutes, buffer_minutes: tg.buffer_minutes, stations: tg.stations });
  const [error, setError] = useState<string | null>(null);

  const saveSettings = async () => {
    const { error } = await supabase.from('tournament_games').update(settings).eq('id', tg.id);
    if (error) setError(error.message);
    else onChange();
  };
  const remove = async () => {
    if (!confirm(`Remove ${game?.name} and all its players and matches from this tournament?`)) return;
    const { error } = await supabase.from('tournament_games').delete().eq('id', tg.id);
    if (error) setError(error.message);
    else onChange();
  };
  const removeTeam = async (t: Team) => {
    if (!confirm(`Remove ${t.name}?`)) return;
    const { error } = await supabase.from('teams').delete().eq('id', t.id);
    if (error) setError(error.message);
    else onChange();
  };
  const setSeed = async (t: Team, seed: string) => {
    const { error } = await supabase.from('teams').update({ seed: seed ? Number(seed) : null }).eq('id', t.id);
    if (error) setError(error.message);
  };

  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Avatar name={game?.name ?? '?'} url={game?.cover_url} size={44} />
        <div className="flex-1">
          <div className="font-display text-lg font-bold">{game?.name}</div>
          <div className="text-sm text-muted">
            {teamSize === 1 ? 'Solo' : `${teamSize} players per side`} · {teams.length} {teamSize === 1 ? 'players' : 'teams'}
          </div>
        </div>
        <StatusPill status={tg.status.replace('_', ' ')} />
        <Button variant="danger" onClick={remove}>
          Remove
        </Button>
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Minutes per match">
          <input type="number" min={1} className="w-28" value={settings.match_minutes} onChange={(e) => setSettings({ ...settings, match_minutes: Number(e.target.value) })} />
        </Field>
        <Field label="Break between">
          <input type="number" min={0} className="w-28" value={settings.buffer_minutes} onChange={(e) => setSettings({ ...settings, buffer_minutes: Number(e.target.value) })} />
        </Field>
        <Field label="Stations">
          <input type="number" min={1} max={64} className="w-24" value={settings.stations} onChange={(e) => setSettings({ ...settings, stations: Number(e.target.value) })} />
        </Field>
        <Button variant="ghost" onClick={saveSettings}>
          Save settings
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {teams.map((t) => (
          <div key={t.id} className="glass-card flex items-center gap-3 px-3 py-2">
            <Avatar name={t.name} url={t.logo_url} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{t.name}</div>
              {t.members.length > 0 && <div className="truncate text-xs text-muted">{t.members.join(', ')}</div>}
            </div>
            <input
              title="Seed (optional, 1 = best)"
              placeholder="Seed"
              type="number"
              min={1}
              className="w-20"
              defaultValue={t.seed ?? ''}
              disabled={hasFixtures}
              onBlur={(e) => setSeed(t, e.target.value)}
            />
            {!hasFixtures && (
              <button className="text-muted hover:text-danger" onClick={() => removeTeam(t)} aria-label={`Remove ${t.name}`}>
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {hasFixtures ? (
        <p className="mt-3 text-sm text-muted">Fixtures exist for this game. To change the line-up, regenerate the fixtures before any match starts.</p>
      ) : null}
      <AddTeam tg={tg} teamSize={teamSize} onAdded={onChange} />
      <ErrorNote message={error} />
    </Panel>
  );
}

function AddTeam({ tg, teamSize, onAdded }: { tg: TournamentGame; teamSize: number; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>(() => Array(teamSize).fill(''));
  const [logo, setLogo] = useState<File | null>(null);
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setMembers((m) => Array.from({ length: teamSize }, (_, i) => m[i] ?? '')), [teamSize]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (bulk) {
        const rows = bulkText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((line) => {
            const [n, rest] = line.split(':');
            return { tournament_game_id: tg.id, name: n.trim(), members: rest ? rest.split(',').map((s) => s.trim()).filter(Boolean) : [] };
          });
        const { error } = await supabase.from('teams').insert(rows);
        if (error) throw new Error(error.message);
        setBulkText('');
      } else {
        const logo_url = logo ? await uploadImage(logo, 'teams') : null;
        const cleanMembers = teamSize > 1 ? members.map((m) => m.trim()).filter(Boolean) : [];
        const { error } = await supabase.from('teams').insert({ tournament_game_id: tg.id, name: name.trim(), members: cleanMembers, logo_url });
        if (error) throw new Error(error.message);
        setName('');
        setMembers(Array(teamSize).fill(''));
        setLogo(null);
      }
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const noun = teamSize === 1 ? 'player' : 'team';
  return (
    <form onSubmit={submit} className="mt-4 border-t border-line pt-4">
      <div className="mb-3 flex items-center gap-4">
        <span className="hud text-xs text-pink glow-pink">Add {noun}</span>
        <button type="button" className="text-sm text-muted hover:text-cyan" onClick={() => setBulk(!bulk)}>
          {bulk ? 'Add one at a time' : 'Paste a list'}
        </button>
      </div>
      {bulk ? (
        <Field label={`One ${noun} per line`} hint={teamSize > 1 ? 'Format: Team name: player 1, player 2' : 'Just the player name'}>
          <textarea rows={5} value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
        </Field>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={teamSize === 1 ? 'Player name / gamertag' : 'Team name'}>
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {teamSize > 1 &&
            members.map((m, i) => (
              <Field key={i} label={`Player ${i + 1}`}>
                <input className="w-36" value={m} onChange={(e) => setMembers(members.map((x, j) => (j === i ? e.target.value : x)))} />
              </Field>
            ))}
          <Field label="Logo / photo">
            <input type="file" accept="image/*" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
      )}
      <ErrorNote message={error} />
      <Button className="mt-3" disabled={busy}>
        Add
      </Button>
    </form>
  );
}

/* ----------------------------------------------------- Fixtures & matches */

function FixturesPanel({ tournament, data, onChange }: { tournament: Tournament; data: LiveData; onChange: () => void }) {
  const { roundsByTg, gameOf } = useLookups(data);
  const tgames = [...data.tgames.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const [tgId, setTgId] = useState<string | null>(null);
  const [view, setView] = useState<'bracket' | 'schedule'>('bracket');
  const [swapMode, setSwapMode] = useState(false);
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const [openMatch, setOpenMatch] = useState<string | null>(null);
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tgId && tgames.length) setTgId(tgames[0].id);
  }, [tgId, tgames]);

  const tg = tgId ? data.tgames.get(tgId) : undefined;
  const matches = useMemo(() => [...data.matches.values()].filter((m) => m.tournament_game_id === tgId), [data.matches, tgId]);
  const teams = [...data.teams.values()].filter((t) => t.tournament_game_id === tgId);
  const started = matches.some((m) => m.status === 'live' || (m.status === 'completed' && !m.is_bye));
  const conflicts = useMemo(() => findTeamConflicts([...data.matches.values()]), [data.matches]);
  const fit = useMemo(() => (tg && matches.length ? previewSchedule(tournament, tg, matches.filter((m) => m.status !== 'live' && m.status !== 'completed')) : null), [tournament, tg, matches]);

  if (tgames.length === 0) return <Empty>Add a game first.</Empty>;

  const act = async (fn: () => Promise<ScheduleResult | void>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r) setResult(r);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const generate = () => {
    if (!tg) return;
    if (teams.length < 2) return setError('Add at least two players or teams first.');
    if (matches.length && !confirm('Replace the current fixtures? Any edits to them will be lost.')) return;
    void act(() => generateFixtures(tournament, tg, teams));
  };

  const onSlotClick = (ref: SlotRef) => {
    if (!selected) return setSelected(ref);
    const first = selected;
    setSelected(null);
    if (first.matchId === ref.matchId && first.slot === ref.slot) return;
    void act(() => swapSlots(first, ref));
  };

  const open = openMatch ? data.matches.get(openMatch) : undefined;
  const gameName = (m: Match) => gameOf(m.tournament_game_id)?.name ?? '';
  const teamName = (id: string) => data.teams.get(id)?.name ?? '?';

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {tgames.map((g) => (
          <button
            key={g.id}
            onClick={() => {
              setTgId(g.id);
              setResult(null);
              setSelected(null);
            }}
            className={`font-display rounded-xl border px-4 py-2 text-xs font-bold tracking-widest uppercase backdrop-blur ${
              g.id === tgId ? 'border-cyan bg-cyan/15 text-cyan shadow-[0_0_18px_rgba(0,240,255,0.35)]' : 'border-line bg-white/5 text-muted hover:text-ink'
            }`}
          >
            {data.games.get(g.game_id)?.name}
          </button>
        ))}
      </div>

      {tg && (
        <Panel className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy || started} onClick={generate} title={started ? 'Matches have started' : undefined}>
              {matches.length ? 'Regenerate fixtures' : 'Generate fixtures'}
            </Button>
            <Button variant="ghost" disabled={busy || !matches.length} onClick={() => act(() => reflowSchedule(tournament, tg, matches))}>
              Reflow times from now
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !matches.length}
              onClick={() => {
                setSwapMode(!swapMode);
                setSelected(null);
              }}
              className={swapMode ? 'border-cyan text-cyan' : ''}
            >
              {swapMode ? 'Done editing' : 'Edit matchups'}
            </Button>
            <span className="flex-1" />
            <span className="text-sm text-muted">
              {teams.length} entrants · {tg.stations} station{tg.stations > 1 ? 's' : ''} · {tg.match_minutes}+{tg.buffer_minutes} min
            </span>
          </div>
          {swapMode && <p className="mt-3 text-sm text-cyan">Click one player slot, then another, to swap them. Only matches that have not started can change.</p>}
          {(result ?? fit) && <FitNote result={(result ?? fit)!} tz={tournament.timezone} />}
          {conflicts.length > 0 && (
            <div className="mt-3 text-sm text-amber">
              Overlaps: {conflicts.slice(0, 5).map((c) => teamName(c.teamId)).join(', ')}
              {conflicts.length > 5 ? ` and ${conflicts.length - 5} more` : ''} {conflicts.length === 1 ? 'is' : 'are'} booked in two matches at once.
            </div>
          )}
          <ErrorNote message={error} />
        </Panel>
      )}

      <div className="mb-4 flex gap-4 border-b border-line">
        {(['bracket', 'schedule'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`hud -mb-px border-b-2 pb-2 text-xs ${view === v ? 'border-pink text-pink' : 'border-transparent text-muted'}`}
          >
            {v}
          </button>
        ))}
      </div>

      {matches.length === 0 ? (
        <Empty>No fixtures yet. Add players, then generate fixtures.</Empty>
      ) : view === 'bracket' ? (
        <Bracket
          matches={matches}
          teams={data.teams}
          timeZone={tournament.timezone}
          onMatchClick={swapMode ? undefined : (m) => setOpenMatch(m.id)}
          onSlotClick={swapMode ? onSlotClick : undefined}
          selectedSlot={selected}
        />
      ) : (
        <ScheduleList matches={matches} teams={data.teams} timeZone={tournament.timezone} label={gameName} onMatchClick={(m) => setOpenMatch(m.id)} />
      )}

      {open && tg && (
        <MatchControl
          match={open}
          teams={data.teams}
          totalRounds={roundsByTg.get(open.tournament_game_id) ?? open.round}
          gameName={gameName(open)}
          timeZone={tournament.timezone}
          matchMinutes={tg.match_minutes}
          onClose={() => setOpenMatch(null)}
        />
      )}
    </div>
  );
}

function FitNote({ result, tz }: { result: ScheduleResult; tz: string }) {
  if (!result.slots.length) return null;
  return result.fits ? (
    <div className="mt-3 text-sm text-lime">Fits in the tournament hours. Last match ends around {formatTime(result.finishesAt, tz)}.</div>
  ) : (
    <div className="mt-3 text-sm text-danger">
      Doesn't fit: the schedule runs about {result.overflowMinutes} minutes past the last day. Add stations, shorten matches, or add a day.
    </div>
  );
}

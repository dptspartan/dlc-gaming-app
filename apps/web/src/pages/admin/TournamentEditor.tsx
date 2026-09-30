import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  describeGroupSetup,
  findTeamConflicts,
  formatTime,
  type Format,
  type Match,
  type StationState,
  type Team,
  type TimetableResult,
  type Tournament,
  type TournamentGame,
} from '@dlc/core';
import { Bracket, type SlotRef } from '../../components/Bracket';
import { GroupTables } from '../../components/GroupTables';
import { ScheduleList } from '../../components/ScheduleList';
import { StationBoard, Timetable } from '../../components/StationBoard';
import { Avatar, Button, Empty, ErrorNote, Field, Heading, Panel, StatusPill, Tabs } from '../../components/ui';
import {
  buildKnockout,
  callMatch,
  generateFixtures,
  groupQualifiers,
  previewTimetable,
  refreshTimetable,
  startMatch,
  swapSlots,
  uncallMatch,
} from '../../lib/admin';
import { supabase, uploadImage } from '../../lib/supabase';
import { useLiveData, useLookups, type LiveData } from '../../lib/useLiveData';
import { useStationMasters } from '../../lib/useStationMasters';
import { MatchControl } from './MatchControl';

type Tab = 'control' | 'games' | 'fixtures' | 'stations' | 'details';

export function TournamentEditor() {
  const { id = '' } = useParams();
  const { data, error, reload } = useLiveData({ tournamentId: id });
  const [tab, setTab] = useState<Tab>('control');
  const tournament = data.tournaments.get(id);
  if (!tournament) return error ? <ErrorNote message={error} /> : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Heading sub={<StatusPill status={tournament.status} />}>{tournament.name}</Heading>
        <div className="flex gap-2">
          <Link to={`/t/${tournament.slug}`} className="font-display rounded-lg border border-line bg-white/5 px-3 py-2 text-xs font-bold tracking-widest uppercase backdrop-blur hover:border-ember">
            Public page
          </Link>
          <Link to={`/t/${tournament.slug}/live`} className="font-display rounded-lg border border-flame/70 bg-flame/10 px-3 py-2 text-xs font-bold tracking-widest text-flame uppercase shadow-[0_0_16px_rgba(255,30,45,0.35)]">
            Live board
          </Link>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['control', 'Control room'],
          ['games', 'Games & players'],
          ['fixtures', 'Fixtures'],
          ['stations', 'Stations & staff'],
          ['details', 'Details'],
        ]}
      />
      {tab === 'control' && <ControlRoom tournament={tournament} data={data} />}
      {tab === 'stations' && <StationsPanel tournament={tournament} data={data} onSaved={reload} />}
      {tab === 'details' && <Details tournament={tournament} onSaved={reload} />}
      {tab === 'games' && <GamesPanel tournament={tournament} data={data} onChange={reload} />}
      {tab === 'fixtures' && <FixturesPanel tournament={tournament} data={data} onChange={reload} />}
    </div>
  );
}

/* ------------------------------------------------------------- Control room */

/** Run the venue: call players to free stations, start matches, move the queue around. */
function ControlRoom({ tournament, data }: { tournament: Tournament; data: LiveData }) {
  const { roundsByTg, gameOf } = useLookups(data);
  const { byStation } = useStationMasters(tournament.id);
  const tgames = useMemo(() => [...data.tgames.values()], [data.tgames]);
  const matches = useMemo(() => [...data.matches.values()], [data.matches]);
  const [openMatch, setOpenMatch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fit = useMemo(() => (matches.length ? safePreview(tournament, tgames, matches) : null), [tournament, tgames, matches]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!matches.length) return <Empty>Generate the fixtures first. The control room fills up once matches are planned.</Empty>;

  const gameName = (m: Match) => gameOf(m.tournament_game_id)?.name ?? '';
  const name = (id: string | null) => (id ? data.teams.get(id)?.name ?? '?' : 'TBD');
  const count = (st: Match['status']) => matches.filter((m) => m.status === st && !m.is_bye).length;
  // Any ready match this station may host, soonest planned first.
  const callable = (station: number) =>
    matches
      .filter((m) => m.status === 'ready' && !m.is_bye && m.team_a_id && m.team_b_id)
      .filter((m) => {
        const allowed = data.tgames.get(m.tournament_game_id)?.allowed_stations;
        return !allowed?.length || allowed.includes(station);
      })
      .sort((a, b) => (a.scheduled_start ?? '9').localeCompare(b.scheduled_start ?? '9'));

  const actions = (s: StationState<Match>) => {
    const m = s.current;
    if (m?.status === 'called')
      return (
        <div className="mb-2 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => act(() => startMatch(m))}>
            Start match
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => act(() => uncallMatch(m, 10))} title="Back to the queue for 10 minutes; the next match takes this station">
            Skip 10 min
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => act(() => uncallMatch(m, 0))}>
            Cancel call
          </Button>
        </div>
      );
    if (m?.status === 'live')
      return (
        <div className="mb-2">
          <Button variant="ghost" onClick={() => setOpenMatch(m.id)}>
            Score & finish
          </Button>
        </div>
      );
    const options = callable(s.station);
    const next = s.queue.find((q) => q.status === 'ready' && q.team_a_id && q.team_b_id) ?? options[0];
    return (
      <div className="mb-2 flex flex-col gap-2">
        {next ? (
          <Button disabled={busy} onClick={() => act(() => callMatch(next, s.station))} className="w-full">
            Call {name(next.team_a_id)} v {name(next.team_b_id)}
          </Button>
        ) : (
          <span className="text-sm text-muted">No match ready for this station.</span>
        )}
        {options.length > 1 && (
          <select
            value=""
            disabled={busy}
            onChange={(e) => {
              const pick = data.matches.get(e.target.value);
              if (pick) void act(() => callMatch(pick, s.station));
            }}
          >
            <option value="">Call a different match…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {gameName(o)}: {name(o.team_a_id)} v {name(o.team_b_id)}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  };

  const open = openMatch ? data.matches.get(openMatch) : undefined;
  const openTg = open ? data.tgames.get(open.tournament_game_id) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <Panel className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Stat label="Live" value={count('live')} tone="text-flame" />
        <Stat label="Players called" value={count('called')} tone="text-gold" />
        <Stat label="Ready to call" value={count('ready')} />
        <Stat label="Waiting for teams" value={count('pending')} />
        <span className="flex-1" />
        <Button variant="ghost" disabled={busy} onClick={() => act(() => refreshTimetable(tournament.id))} title="Give every queued match a station and a time, from now">
          Rebuild timetable
        </Button>
        {fit && (
          <div className="w-full">
            <FitNote result={fit} tz={tournament.timezone} />
          </div>
        )}
      </Panel>
      <p className="-mt-2 text-sm text-muted">
        Calling a match puts it on the live board as "Waiting for players" with a {tournament.call_minutes} minute countdown. Start it once both sides are at the station.
        Skipping sends it back to the queue and the next match takes the station.
      </p>
      <ErrorNote message={error} />
      <StationBoard
        matches={matches}
        stations={tournament.stations}
        teams={data.teams}
        timeZone={tournament.timezone}
        callMinutes={tournament.call_minutes}
        gameName={gameName}
        masters={byStation}
        actions={actions}
        onMatchClick={(m) => setOpenMatch(m.id)}
      />
      <div>
        <h2 className="mb-3 text-lg font-bold">Timetable</h2>
        <Timetable matches={matches} teams={data.teams} timeZone={tournament.timezone} gameName={gameName} />
      </div>
      {open && openTg && (
        <MatchControl
          match={open}
          teams={data.teams}
          totalRounds={roundsByTg.get(open.tournament_game_id) ?? open.round}
          gameName={gameName(open)}
          game={data.games.get(openTg.game_id)}
          timeZone={tournament.timezone}
          matchMinutes={openTg.match_minutes}
          callMinutes={tournament.call_minutes}
          onClose={() => setOpenMatch(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'text-ink' }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div className={`text-3xl font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-sm text-muted">{label}</div>
    </div>
  );
}

/* --------------------------------------------------------- Stations & staff */

function StationsPanel({ tournament, data, onSaved }: { tournament: Tournament; data: LiveData; onSaved: () => void }) {
  const { admins, masters, assign, error: loadError } = useStationMasters(tournament.id);
  const [form, setForm] = useState({ stations: tournament.stations, call_minutes: tournament.call_minutes });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const tgames = [...data.tgames.values()];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.from('tournaments').update(form).eq('id', tournament.id);
    if (error) return setError(error.message);
    if (data.matches.size) await refreshTimetable(tournament.id).catch((e: Error) => setError(e.message));
    setSaved(true);
    onSaved();
  };
  const setMaster = (station: number, userId: string) => assign(station, userId || null).catch((e: Error) => setError(e.message));
  const gamesOn = (n: number) =>
    tgames
      .filter((tg) => !tg.allowed_stations?.length || tg.allowed_stations.includes(n))
      .map((tg) => data.games.get(tg.game_id)?.name)
      .filter(Boolean)
      .join(', ');

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Panel>
        <form onSubmit={save} className="flex flex-wrap items-end gap-4">
          <Field label="Stations at the venue" hint="Numbered 1, 2, 3…">
            <input type="number" min={1} max={64} className="w-32" value={form.stations} onChange={(e) => (setSaved(false), setForm({ ...form, stations: Number(e.target.value) }))} />
          </Field>
          <Field label="Minutes to reach a station" hint="The countdown after players are called">
            <input type="number" min={1} max={60} className="w-32" value={form.call_minutes} onChange={(e) => (setSaved(false), setForm({ ...form, call_minutes: Number(e.target.value) }))} />
          </Field>
          <Button>Save</Button>
          {saved && <span className="text-gold">Saved, timetable rebuilt</span>}
        </form>
        <ErrorNote message={error ?? loadError} />
      </Panel>
      <Panel>
        <h2 className="mb-1 text-lg font-bold">Game masters</h2>
        <p className="mb-4 text-sm text-muted">A game master runs one or more stations from the mobile app: calling players, starting matches and scoring them.</p>
        <div className="flex flex-col divide-y divide-line">
          {Array.from({ length: tournament.stations }, (_, i) => i + 1).map((n) => (
            <div key={n} className="grid grid-cols-[4rem_1fr] items-center gap-3 py-2.5 sm:grid-cols-[5rem_16rem_1fr]">
              <span className="text-xl font-bold">#{n}</span>
              <select value={masters.find((m) => m.station === n)?.user_id ?? ''} onChange={(e) => setMaster(n, e.target.value)}>
                <option value="">No game master</option>
                {admins.map((a) => (
                  <option key={a.user_id} value={a.user_id}>
                    {a.email}
                  </option>
                ))}
              </select>
              <span className="col-span-2 text-sm text-muted sm:col-span-1">{gamesOn(n) || 'No game plays here'}</span>
            </div>
          ))}
        </div>
      </Panel>
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
          {saved && <span className="text-gold">Saved</span>}
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
  const [format, setFormat] = useState<FormatSettings>(defaultFormat);
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const game = data.games.get(gameId);
    if (!game) return;
    const { error } = await supabase
      .from('tournament_games')
      .insert({ tournament_id: tournament.id, game_id: game.id, match_minutes: game.default_match_minutes, buffer_minutes: 5, stations_required: 1, ...format });
    if (error) setError(error.message);
    else {
      setGameId('');
      setFormat(defaultFormat);
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
          <FormatFields value={format} onChange={setFormat} />
          <Button disabled={!gameId}>Add game</Button>
          <Link to="/admin/games" className="text-sm text-muted hover:text-ember">
            Manage the game catalog
          </Link>
        </form>
        <ErrorNote message={error} />
      </Panel>
      {tgames.length === 0 && <Empty>No games yet. Add one above.</Empty>}
      {tgames.map((tg) => (
        <TournamentGameCard key={tg.id} tg={tg} stations={tournament.stations} data={data} onChange={onChange} />
      ))}
    </div>
  );
}

type FormatSettings = Pick<TournamentGame, 'format' | 'group_count' | 'advance_per_group' | 'wildcards'>;

const defaultFormat: FormatSettings = { format: 'knockout', group_count: 2, advance_per_group: 2, wildcards: 0 };
const formatOf = (tg: TournamentGame): FormatSettings => ({
  format: tg.format,
  group_count: tg.group_count,
  advance_per_group: tg.advance_per_group,
  wildcards: tg.wildcards,
});

/** Knockout, or groups (how many, how many go through, wildcards) then a knockout. */
function FormatFields({ value, onChange }: { value: FormatSettings; onChange: (v: FormatSettings) => void }) {
  const num = (key: keyof FormatSettings) => (e: { target: { value: string } }) => onChange({ ...value, [key]: Number(e.target.value) });
  return (
    <>
      <Field label="Format">
        <select value={value.format} onChange={(e) => onChange({ ...value, format: e.target.value as Format })}>
          <option value="knockout">Knockout</option>
          <option value="groups">Groups, then knockout</option>
        </select>
      </Field>
      {value.format === 'groups' && (
        <>
          <Field label="Groups">
            <input type="number" min={1} max={32} className="w-20" value={value.group_count} onChange={num('group_count')} />
          </Field>
          <Field label="Go through per group">
            <input type="number" min={1} max={16} className="w-24" value={value.advance_per_group} onChange={num('advance_per_group')} />
          </Field>
          <Field label="Wildcards">
            <input type="number" min={0} max={64} className="w-20" value={value.wildcards} onChange={num('wildcards')} title="Best teams that finish outside the qualifying places" />
          </Field>
        </>
      )}
    </>
  );
}

function TournamentGameCard({ tg, stations, data, onChange }: { tg: TournamentGame; stations: number; data: LiveData; onChange: () => void }) {
  const game = data.games.get(tg.game_id);
  const teamSize = game?.team_size ?? 1;
  const teams = [...data.teams.values()].filter((t) => t.tournament_game_id === tg.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const hasFixtures = [...data.matches.values()].some((m) => m.tournament_game_id === tg.id);
  const [settings, setSettings] = useState({
    match_minutes: tg.match_minutes,
    buffer_minutes: tg.buffer_minutes,
    stations_required: tg.stations_required,
    allowed_stations: tg.allowed_stations ?? [],
  });
  const toggleStation = (n: number) =>
    setSettings((s) => ({
      ...s,
      allowed_stations: s.allowed_stations.includes(n) ? s.allowed_stations.filter((x) => x !== n) : [...s.allowed_stations, n].sort((a, b) => a - b),
    }));
  const [format, setFormat] = useState<FormatSettings>(formatOf(tg));
  const formatChanged = JSON.stringify(format) !== JSON.stringify(formatOf(tg));
  const [error, setError] = useState<string | null>(null);

  const saveSettings = async () => {
    const allowed_stations = settings.allowed_stations.length ? settings.allowed_stations : null;
    const { error } = await supabase.from('tournament_games').update({ ...settings, allowed_stations, ...format }).eq('id', tg.id);
    if (error) return setError(error.message);
    // Times and stations follow the new settings.
    if (hasFixtures) await refreshTimetable(tg.tournament_id).catch((e: Error) => setError(e.message));
    onChange();
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
        <Field label="Stations per match">
          <input
            type="number"
            min={1}
            max={16}
            className="w-28"
            value={settings.stations_required}
            onChange={(e) => setSettings({ ...settings, stations_required: Number(e.target.value) })}
          />
        </Field>
        <FormatFields value={format} onChange={setFormat} />
        <Button variant="ghost" onClick={saveSettings}>
          Save settings
        </Button>
      </div>
      <div className="-mt-2 mb-5">
        <div className="field-label hud mb-1.5 text-[11px] text-ember/80">Plays on stations</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {Array.from({ length: stations }, (_, i) => i + 1).map((n) => {
            const on = settings.allowed_stations.includes(n);
            return (
              <button
                key={n}
                type="button"
                onClick={() => toggleStation(n)}
                className={`h-9 min-w-9 rounded-lg border px-2 text-sm font-semibold ${on ? 'border-ember bg-ember/20 text-ink' : 'border-line bg-white/5 text-muted hover:text-ink'}`}
              >
                {n}
              </button>
            );
          })}
          <span className="ml-2 text-sm text-muted">
            {settings.allowed_stations.length ? `Only ${settings.allowed_stations.join(', ')}` : 'Any free station'}
            {settings.stations_required > 1 ? ` · takes ${settings.stations_required} at once` : ''}
          </span>
        </div>
      </div>
      {format.format === 'groups' && (
        <p className="-mt-3 mb-5 text-sm text-muted">{describeGroupSetup(teams.length, format.group_count, format.advance_per_group, format.wildcards)}</p>
      )}
      {formatChanged && hasFixtures && <p className="-mt-3 mb-5 text-sm text-amber">Save, then regenerate the fixtures for a new format to take effect.</p>}

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
        <span className="hud text-xs text-flame glow-flame">Add {noun}</span>
        <button type="button" className="text-sm text-muted hover:text-ember" onClick={() => setBulk(!bulk)}>
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
  const [view, setView] = useState<'groups' | 'bracket' | 'schedule' | null>(null);
  const [swapMode, setSwapMode] = useState(false);
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const [openMatch, setOpenMatch] = useState<string | null>(null);
  const [result, setResult] = useState<TimetableResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tgId && tgames.length) setTgId(tgames[0].id);
  }, [tgId, tgames]);

  const tg = tgId ? data.tgames.get(tgId) : undefined;
  const matches = useMemo(() => [...data.matches.values()].filter((m) => m.tournament_game_id === tgId), [data.matches, tgId]);
  const teams = [...data.teams.values()].filter((t) => t.tournament_game_id === tgId);
  const started = matches.some((m) => m.status === 'live' || (m.status === 'completed' && !m.is_bye));
  const hasGroups = tg?.format === 'groups' && matches.some((m) => m.stage === 'group');
  const groupMatches = matches.filter((m) => m.stage === 'group');
  const knockout = matches.filter((m) => m.stage !== 'group');
  const groupsDone = groupMatches.length > 0 && groupMatches.every((m) => m.status === 'completed');
  const knockoutStarted = knockout.some((m) => m.status === 'live' || (m.status === 'completed' && !m.is_bye));
  const through = tg && hasGroups ? groupQualifiers(tg, teams, matches) : [];
  const shown = view === 'groups' && !hasGroups ? 'bracket' : view ?? (hasGroups && !knockout.length ? 'groups' : 'bracket');
  const conflicts = useMemo(() => findTeamConflicts([...data.matches.values()]), [data.matches]);
  const all = useMemo(() => [...data.matches.values()], [data.matches]);
  const fit = useMemo(() => (all.length ? safePreview(tournament, tgames, all) : null), [tournament, tgames, all]);

  if (tgames.length === 0) return <Empty>Add a game first.</Empty>;

  const act = async (fn: () => Promise<TimetableResult | void>) => {
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
    void act(() => generateFixtures(tournament, tgames, tg, teams, all));
  };

  const startKnockout = () => {
    if (!tg) return;
    if (knockout.length && !confirm('Rebuild the knockout from the current group tables?')) return;
    void act(async () => {
      const r = await buildKnockout(tournament, tgames, tg, teams, all);
      setView('bracket');
      return r;
    });
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
              g.id === tgId ? 'border-ember bg-ember/15 text-ember shadow-[0_0_18px_rgba(255,42,74,0.35)]' : 'border-line bg-white/5 text-muted hover:text-ink'
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
            <Button variant="ghost" disabled={busy || !all.length} onClick={() => act(() => refreshTimetable(tournament.id))} title="Give every queued match a station and a time, from now">
              Rebuild timetable
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !matches.length}
              onClick={() => {
                setSwapMode(!swapMode);
                setSelected(null);
              }}
              className={swapMode ? 'border-ember text-ember' : ''}
            >
              {swapMode ? 'Done editing' : 'Edit matchups'}
            </Button>
            <span className="flex-1" />
            <span className="text-sm text-muted">
              {teams.length} entrants · {tg.stations_required > 1 ? `${tg.stations_required} stations per match · ` : ''}
              {tg.match_minutes}+{tg.buffer_minutes} min
            </span>
          </div>
          {hasGroups && (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
              <Button
                variant={groupsDone && !knockout.length ? 'success' : 'ghost'}
                disabled={busy || !groupsDone || knockoutStarted}
                onClick={startKnockout}
                title={!groupsDone ? 'Finish every group match first' : knockoutStarted ? 'The knockout has started' : undefined}
              >
                {knockout.length ? 'Rebuild knockout' : 'Start knockout'}
              </Button>
              <span className="text-sm text-muted">
                {groupsDone
                  ? `Going through (best first): ${through.map(teamName).join(', ')}`
                  : `${groupMatches.filter((m) => m.status === 'completed').length} of ${groupMatches.length} group matches played. The knockout is drawn when they are all done.`}
              </span>
            </div>
          )}
          {swapMode && <p className="mt-3 text-sm text-ember">Click one player slot, then another, to swap them. Only matches that have not started can change.</p>}
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
        {(hasGroups ? (['groups', 'bracket', 'schedule'] as const) : (['bracket', 'schedule'] as const)).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`hud -mb-px border-b-2 pb-2 text-xs ${shown === v ? 'border-flame text-flame' : 'border-transparent text-muted'}`}
          >
            {v === 'bracket' && hasGroups ? 'knockout' : v}
          </button>
        ))}
      </div>

      {matches.length === 0 ? (
        <Empty>No fixtures yet. Add players, then generate fixtures.</Empty>
      ) : shown === 'groups' && tg ? (
        <GroupTables tg={tg} teams={teams} matches={matches} onMatchClick={(m) => setOpenMatch(m.id)} />
      ) : shown === 'bracket' && hasGroups && !knockout.length ? (
        <Empty>The knockout is drawn from the group tables once every group match is played.</Empty>
      ) : shown === 'bracket' ? (
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
          game={data.games.get(tg.game_id)}
          timeZone={tournament.timezone}
          matchMinutes={tg.match_minutes}
          callMinutes={tournament.call_minutes}
          onClose={() => setOpenMatch(null)}
        />
      )}
    </div>
  );
}

function safePreview(tournament: Tournament, tgames: TournamentGame[], matches: Match[]) {
  try {
    return previewTimetable(tournament, tgames, matches);
  } catch {
    return null;
  }
}

function FitNote({ result, tz }: { result: TimetableResult; tz: string }) {
  if (result.unplaced.length)
    return <div className="mt-3 text-sm text-danger">{result.unplaced.length} matches can't be placed: a game needs more stations than it is allowed. Check the games' stations.</div>;
  if (!result.slots.length) return null;
  return result.fits ? (
    <div className="mt-3 text-sm text-gold">Fits in the tournament hours. Last match ends around {formatTime(result.finishesAt, tz)}.</div>
  ) : (
    <div className="mt-3 text-sm text-danger">
      Doesn't fit: the schedule runs about {result.overflowMinutes} minutes past the last day. Add stations, shorten matches, or add a day.
    </div>
  );
}

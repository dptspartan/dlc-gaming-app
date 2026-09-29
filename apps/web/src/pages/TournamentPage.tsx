import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { addDays } from '@dlc/core';
import { Bracket } from '../components/Bracket';
import { Layout } from '../components/Layout';
import { ScheduleList } from '../components/ScheduleList';
import { Avatar, Empty, ErrorNote, Heading, StatusPill } from '../components/ui';
import { WinnerOverlay, useWinnerQueue } from '../components/WinnerOverlay';
import { useLiveData } from '../lib/useLiveData';
import { useTournamentId } from '../lib/useTournamentBySlug';

export function TournamentPage() {
  const { slug } = useParams();
  const { id, notFound } = useTournamentId(slug);
  if (notFound) {
    return (
      <Layout>
        <Empty>Tournament not found.</Empty>
      </Layout>
    );
  }
  if (!id) return <Layout>{null}</Layout>;
  return <TournamentView id={id} />;
}

function TournamentView({ id }: { id: string }) {
  const overlay = useWinnerQueue();
  const { data, error } = useLiveData({ tournamentId: id, onMatchCompleted: overlay.push });
  const tournament = data.tournaments.get(id);
  const tgames = useMemo(
    () =>
      [...data.tgames.values()]
        .filter((tg) => tg.tournament_id === id)
        .sort((a, b) => (data.games.get(a.game_id)?.name ?? '').localeCompare(data.games.get(b.game_id)?.name ?? '')),
    [data, id],
  );
  const [tab, setTab] = useState<string | null>(null);
  const [view, setView] = useState<'bracket' | 'schedule' | 'players'>('bracket');
  useEffect(() => {
    if (!tab && tgames.length) setTab(tgames[0].id);
  }, [tab, tgames]);

  if (!tournament) return <Layout>{error ? <ErrorNote message={error} /> : null}</Layout>;

  const tg = tgames.find((g) => g.id === tab);
  const game = tg ? data.games.get(tg.game_id) : undefined;
  const matches = [...data.matches.values()].filter((m) => m.tournament_game_id === tab);
  const teams = [...data.teams.values()].filter((t) => t.tournament_game_id === tab).sort((a, b) => a.name.localeCompare(b.name));
  const champion = tg?.champion_team_id ? data.teams.get(tg.champion_team_id) : undefined;
  const liveCount = [...data.matches.values()].filter((m) => m.status === 'live').length;

  return (
    <Layout wide>
      <WinnerOverlay match={overlay.current} data={data} onDone={overlay.shift} />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <Heading
          sub={`${tournament.start_date}${tournament.days > 1 ? ` → ${addDays(tournament.start_date, tournament.days - 1)}` : ''} · daily ${tournament.daily_start.slice(0, 5)}–${tournament.daily_end.slice(0, 5)} (${tournament.timezone})`}
        >
          {tournament.name}
        </Heading>
        <Link
          to={`/t/${tournament.slug}/live`}
          className="font-display flex items-center gap-2 rounded-xl border border-flame/70 bg-flame/10 px-4 py-2 text-xs font-bold tracking-widest text-flame uppercase shadow-[0_0_20px_rgba(255,30,45,0.35)] backdrop-blur hover:bg-flame hover:text-bg"
        >
          <span className="live-dot" style={{ width: 8, height: 8 }} /> Live board {liveCount > 0 && `(${liveCount})`}
        </Link>
      </div>

      {tgames.length === 0 && <Empty>Games will appear here once they are added.</Empty>}

      <div className="mb-4 flex flex-wrap gap-2">
        {tgames.map((g) => (
          <button
            key={g.id}
            onClick={() => setTab(g.id)}
            className={`font-display rounded-xl border px-4 py-2 text-xs font-bold tracking-widest uppercase backdrop-blur transition ${
              g.id === tab ? 'border-ember bg-ember/15 text-ember shadow-[0_0_18px_rgba(255,42,74,0.35)]' : 'border-line bg-white/5 text-muted hover:text-ink'
            }`}
          >
            {data.games.get(g.game_id)?.name ?? 'Game'}
            {g.status === 'live' && <span className="live-dot ml-2 inline-block" style={{ width: 7, height: 7 }} />}
          </button>
        ))}
      </div>

      {tg && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-4 text-muted">
            <StatusPill status={tg.status.replace('_', ' ')} />
            <span>{game?.team_size === 1 ? 'Solo' : `${game?.team_size}v${game?.team_size}`}</span>
            <span>~{tg.match_minutes} min per match</span>
            <span>{tg.stations} station{tg.stations > 1 ? 's' : ''}</span>
            <span>{teams.length} {game?.team_size === 1 ? 'players' : 'teams'}</span>
          </div>

          {champion && (
            <div className="panel neon-gold mb-6 flex items-center gap-4 p-4">
              <span className="text-4xl">🏆</span>
              <Avatar name={champion.name} url={champion.logo_url} size={48} ring="#ff6b81" />
              <div>
                <div className="hud text-xs text-amber">Champion</div>
                <div className="font-display text-2xl font-bold">{champion.name}</div>
              </div>
            </div>
          )}

          <div className="mb-4 flex gap-4 border-b border-line">
            {(['bracket', 'schedule', 'players'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`hud -mb-px border-b-2 px-1 pb-2 text-xs ${view === v ? 'border-flame text-flame glow-flame' : 'border-transparent text-muted hover:text-ink'}`}
              >
                {v === 'players' ? (game?.team_size === 1 ? 'Players' : 'Teams') : v}
              </button>
            ))}
          </div>

          {view === 'bracket' &&
            (matches.length ? <Bracket matches={matches} teams={data.teams} timeZone={tournament.timezone} /> : <Empty>Fixtures are not out yet.</Empty>)}
          {view === 'schedule' && <ScheduleList matches={matches} teams={data.teams} timeZone={tournament.timezone} />}
          {view === 'players' && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {teams.map((t) => (
                <div key={t.id} className="panel flex items-center gap-3">
                  <Avatar name={t.name} url={t.logo_url} size={40} />
                  <div className="min-w-0">
                    <div className="truncate font-bold">
                      {t.name} {t.seed ? <span className="text-xs text-muted">#{t.seed}</span> : null}
                    </div>
                    {t.members.length > 0 && <div className="truncate text-sm text-muted">{t.members.join(', ')}</div>}
                  </div>
                </div>
              ))}
              {teams.length === 0 && <Empty>No entries yet.</Empty>}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}

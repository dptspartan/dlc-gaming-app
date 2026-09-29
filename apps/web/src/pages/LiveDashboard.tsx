import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { formatTime, gridFor, paginate, roundName, type Match } from '@dlc/core';
import { Avatar, Elapsed, ErrorNote } from '../components/ui';
import { WinnerOverlay, useWinnerQueue } from '../components/WinnerOverlay';
import { useLiveData, useLookups, type LiveData } from '../lib/useLiveData';
import { useTournamentId } from '../lib/useTournamentBySlug';

const PAGE_MS = 10_000;

/** /live shows every running tournament; /t/:slug/live shows one. */
export function LiveDashboard() {
  const { slug } = useParams();
  const { id, notFound } = useTournamentId(slug);
  if (slug && notFound) return <div className="p-10 text-center text-muted">Tournament not found.</div>;
  if (slug && !id) return null;
  return <Board tournamentId={id ?? undefined} />;
}

function Board({ tournamentId }: { tournamentId?: string }) {
  const overlay = useWinnerQueue();
  const { data, error } = useLiveData({ tournamentId, onMatchCompleted: overlay.push });
  const { roundsByTg, gameOf } = useLookups(data);
  const [page, setPage] = useState(0);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const all = [...data.matches.values()];
  const live = all.filter((m) => m.status === 'live').sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''));
  const upNext = all
    .filter((m) => (m.status === 'ready' || m.status === 'pending') && !m.is_bye && m.scheduled_start)
    .sort((a, b) => a.scheduled_start!.localeCompare(b.scheduled_start!))
    .slice(0, 8);
  const results = all
    .filter((m) => m.status === 'completed' && !m.is_bye && m.ended_at)
    .sort((a, b) => b.ended_at!.localeCompare(a.ended_at!))
    .slice(0, 8);

  // Venue operators can press W to replay the latest winner announcement.
  const latest = results[0];
  const replay = overlay.push;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'w' && latest) replay(latest);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [latest, replay]);

  const layout = gridFor(live.length);
  const pages = paginate(live, layout.pageSize);
  const current = pages[page % pages.length];
  useEffect(() => {
    if (pages.length <= 1) return;
    const t = setInterval(() => setPage((p) => p + 1), PAGE_MS);
    return () => clearInterval(t);
  }, [pages.length]);

  const tournamentNames = [...data.tournaments.values()].map((t) => t.name);
  const multi = data.tournaments.size > 1;
  const tz = [...data.tournaments.values()][0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <WinnerOverlay match={overlay.current} data={data} onDone={overlay.shift} />
      <header className="flex items-center justify-between gap-4 border-b border-line bg-[#0b0620]/55 px-5 py-3 shadow-[0_1px_0_rgba(255,43,214,0.3)] backdrop-blur-xl">
        <Link to="/" className="font-display text-lg font-black tracking-widest">
          <span className="text-cyan glow-cyan">DLC</span>
          <span className="text-pink glow-pink"> ARENA</span>
        </Link>
        <div className="hud hidden truncate text-sm text-muted md:block">
          {tournamentId ? tournamentNames[0] : tournamentNames.length ? tournamentNames.join(' · ') : 'No events running'}
        </div>
        <div className="flex items-center gap-4">
          <span className="font-display flex items-center gap-2 text-sm font-bold text-pink">
            <span className="live-dot" /> {live.length} LIVE
          </span>
          <span className="rounded-lg border border-cyan/40 bg-cyan/10 px-3 py-1 font-mono text-xl tabular-nums text-cyan glow-cyan">{formatTime(clock, tz)}</span>
        </div>
      </header>
      <ErrorNote message={error} />

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        <main className="min-h-0 flex-1">
          {live.length === 0 ? (
            <NothingLive next={upNext[0]} data={data} tz={tz} />
          ) : (
            <LayoutGroup>
              <div
                className="grid h-full gap-4"
                style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))` }}
              >
                <AnimatePresence mode="popLayout">
                  {current.map((m) => (
                    <LiveCard
                      key={m.id}
                      match={m}
                      data={data}
                      big={live.length === 1}
                      compact={layout.pageSize >= 6}
                      totalRounds={roundsByTg.get(m.tournament_game_id) ?? m.round}
                      gameName={gameOf(m.tournament_game_id)?.name ?? ''}
                      showTournament={multi}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </LayoutGroup>
          )}
          {pages.length > 1 && (
            <div className="mt-2 flex justify-center gap-2">
              {pages.map((_, i) => (
                <span key={i} className={`h-1.5 w-8 rounded-full ${i === page % pages.length ? 'bg-cyan shadow-[0_0_10px_#00f0ff]' : 'bg-white/15'}`} />
              ))}
            </div>
          )}
        </main>

        <aside className="flex max-h-[40vh] w-full shrink-0 flex-col gap-4 overflow-y-auto lg:max-h-none lg:w-80">
          <RailList title="Up next" matches={upNext} data={data} tz={tz} gameOf={gameOf} kind="next" />
          <RailList title="Results" matches={results} data={data} tz={tz} gameOf={gameOf} kind="result" />
        </aside>
      </div>
    </div>
  );
}

function LiveCard({
  match,
  data,
  big,
  compact,
  totalRounds,
  gameName,
  showTournament,
}: {
  match: Match;
  data: LiveData;
  big: boolean;
  compact: boolean;
  totalRounds: number;
  gameName: string;
  showTournament: boolean;
}) {
  const a = match.team_a_id ? data.teams.get(match.team_a_id) : undefined;
  const b = match.team_b_id ? data.teams.get(match.team_b_id) : undefined;
  const game = data.games.get(data.tgames.get(match.tournament_game_id)?.game_id ?? '');
  const final = !match.next_match_id;
  const avatar = big ? 140 : compact ? 56 : 84;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.85, rotateX: -20 }}
      animate={{ opacity: 1, scale: 1, rotateX: 0 }}
      exit={{ opacity: 0, scale: 0.8, filter: 'blur(6px)' }}
      transition={{ type: 'spring', stiffness: 220, damping: 24 }}
      className={`panel scanlines relative flex min-h-[220px] flex-col overflow-hidden p-0 ${final ? 'neon-gold' : 'neon-live'}`}
    >
      {game?.cover_url && <img src={game.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-15" />}
      <div className="relative flex items-center justify-between px-4 pt-3">
        <span className="hud text-xs text-cyan glow-cyan">
          {gameName} · {roundName(match.round, totalRounds)}
        </span>
        <span className="hud flex items-center gap-2 rounded-full border border-pink/60 bg-pink/10 px-2.5 py-0.5 text-xs text-pink">
          <span className="live-dot" style={{ width: 8, height: 8 }} /> {final ? 'FINAL' : 'LIVE'}
        </span>
      </div>
      {showTournament && <div className="relative px-4 text-sm text-muted">{data.tournaments.get(match.tournament_id)?.name}</div>}

      <div className="relative flex flex-1 items-center justify-around gap-2 px-3">
        <Side name={a?.name ?? 'TBD'} url={a?.logo_url} size={avatar} big={big} compact={compact} />
        <div className="flex flex-col items-center">
          <span className={`glitch font-display font-black text-pink glow-pink italic ${big ? 'text-7xl' : compact ? 'text-2xl' : 'text-5xl'}`} data-text="VS">VS</span>
        </div>
        <Side name={b?.name ?? 'TBD'} url={b?.logo_url} size={avatar} big={big} compact={compact} />
      </div>

      <div className="hud relative flex items-center justify-between border-t border-line bg-black/25 px-4 py-2 text-xs text-muted">
        <span>{match.station ? `Station ${match.station}` : ''}</span>
        {match.started_at && (
          <span className={`font-mono text-cyan glow-cyan ${big ? 'text-3xl' : 'text-xl'}`}>
            <Elapsed since={match.started_at} />
          </span>
        )}
      </div>
    </motion.div>
  );
}

function Side({ name, url, size, big, compact }: { name: string; url?: string | null; size: number; big: boolean; compact: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
      <Avatar name={name} url={url} size={size} ring="#00f0ff55" />
      <span className={`font-display w-full truncate font-bold ${big ? 'text-4xl' : compact ? 'text-base' : 'text-xl'}`}>{name}</span>
    </div>
  );
}

function RailList({
  title,
  matches,
  data,
  tz,
  gameOf,
  kind,
}: {
  title: string;
  matches: Match[];
  data: LiveData;
  tz: string;
  gameOf: (tgId: string) => { name: string } | undefined;
  kind: 'next' | 'result';
}) {
  const name = (id: string | null) => (id ? data.teams.get(id)?.name ?? '?' : 'TBD');
  return (
    <div className="panel p-4">
      <div className="hud mb-3 text-xs text-pink glow-pink">▸ {title}</div>
      {matches.length === 0 && <div className="text-sm text-muted">Nothing yet.</div>}
      <AnimatePresence initial={false}>
        {matches.map((m) => (
          <motion.div
            key={m.id}
            layout
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            className="border-b border-line/50 py-2 last:border-0"
          >
            <div className="flex justify-between text-xs text-muted">
              <span className="truncate">{gameOf(m.tournament_game_id)?.name}</span>
              <span className="font-mono text-cyan">
                {kind === 'next' ? formatTime(m.scheduled_start, tz) : formatTime(m.ended_at, tz)}
              </span>
            </div>
            {kind === 'result' ? (
              <div className="truncate">
                <span className="font-bold text-lime">{name(m.winner_id)}</span>
                <span className="text-muted"> beat {name(m.winner_id === m.team_a_id ? m.team_b_id : m.team_a_id)}</span>
                {m.score_a != null && m.score_b != null && (
                  <span className="font-display ml-1 text-sm text-muted">
                    {Math.max(m.score_a, m.score_b)}–{Math.min(m.score_a, m.score_b)}
                  </span>
                )}
              </div>
            ) : (
              <div className="truncate">
                {name(m.team_a_id)} <span className="text-muted">vs</span> {name(m.team_b_id)}
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function NothingLive({ next, data, tz }: { next?: Match; data: LiveData; tz: string }) {
  const name = (id: string | null) => (id ? data.teams.get(id)?.name ?? '?' : 'TBD');
  return (
    <div className="panel scanlines relative flex h-full min-h-[300px] flex-col items-center justify-center gap-4 text-center">
      <div className="hud text-sm text-muted">// stand by</div>
      {next ? (
        <>
          <div className="font-display text-2xl text-cyan glow-cyan sm:text-4xl">
            {name(next.team_a_id)} <span className="text-pink">vs</span> {name(next.team_b_id)}
          </div>
          <div className="text-lg text-muted">Next match at {formatTime(next.scheduled_start, tz)}</div>
        </>
      ) : (
        <div className="font-display text-2xl text-cyan glow-cyan">No matches running right now</div>
      )}
    </div>
  );
}

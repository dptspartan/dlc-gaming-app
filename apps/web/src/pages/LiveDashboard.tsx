import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { formatTime, gridFor, isFinal, matchLabel, paginate, roundsToWin, type Game, type Match } from '@dlc/core';
import { Avatar, Elapsed, ErrorNote } from '../components/ui';
import { Glitch, Particles } from '../components/WinnerOverlay';
import { useLiveData, useLookups, type LiveData } from '../lib/useLiveData';
import { playSfx, useSound } from '../lib/sfx';
import { useTournamentId } from '../lib/useTournamentBySlug';

const PAGE_MS = 10_000;
/** How long a finished match stays on the board, celebrating its winner, before it pops off. */
const CELEBRATE_MS = 7_000;
const CHAMPION_MS = 11_000;
/** How long the "+1" animation plays on a card after a point. */
const BURST_MS = 1_600;

/** A point just scored in a live match: which side, and when (also the animation key). */
type Burst = { side: 'a' | 'b'; at: number };

/** /live shows every running tournament; /t/:slug/live shows one. */
export function LiveDashboard() {
  const { slug } = useParams();
  const { id, notFound } = useTournamentId(slug);
  if (slug && notFound) return <div className="p-10 text-center text-muted">Tournament not found.</div>;
  if (slug && !id) return null;
  return <Board tournamentId={id ?? undefined} />;
}

function Board({ tournamentId }: { tournamentId?: string }) {
  // Finished matches stay on the board for a moment to play their winner animation.
  const [celebrating, setCelebrating] = useState<Set<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [page, setPage] = useState(0);
  const celebrate = useCallback((m: Match) => {
    playSfx(isFinal(m) ? 'champion' : 'win');
    clearTimeout(timers.current.get(m.id));
    setCelebrating((s) => new Set(s).add(m.id));
    setPage(0);
    timers.current.set(
      m.id,
      setTimeout(() => {
        timers.current.delete(m.id);
        setCelebrating((s) => {
          const next = new Set(s);
          next.delete(m.id);
          return next;
        });
      }, isFinal(m) ? CHAMPION_MS : CELEBRATE_MS),
    );
  }, []);
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);
  const { data, error } = useLiveData({ tournamentId, onMatchCompleted: celebrate });
  const { roundsByTg, gameOf } = useLookups(data);
  const bursts = usePointBursts(data);
  const sound = useSound();
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const all = [...data.matches.values()];
  const liveCount = all.filter((m) => m.status === 'live').length;
  // Celebrating cards go first so they are on the page being shown.
  const live = all
    .filter((m) => m.status === 'live' || (m.status === 'completed' && celebrating.has(m.id)))
    .sort((a, b) => Number(celebrating.has(b.id)) - Number(celebrating.has(a.id)) || (a.started_at ?? '').localeCompare(b.started_at ?? ''));
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
  const replay = celebrate;
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
      <header className="flex items-center justify-between gap-4 border-b border-line bg-[#0a0a0a]/55 px-5 py-3 shadow-[0_1px_0_rgba(255,30,45,0.3)] backdrop-blur-xl">
        <Link to="/" className="font-display text-lg font-black tracking-widest">
          <span className="text-ember glow-ember">DLC</span>
          <span className="text-flame glow-flame"> GAMING CLUB</span>
        </Link>
        <div className="hud hidden truncate text-sm text-muted md:block">
          {tournamentId ? tournamentNames[0] : tournamentNames.length ? tournamentNames.join(' · ') : 'No events running'}
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => sound.setEnabled(!sound.enabled)}
            className={`hud rounded-full border px-3 py-1 text-xs transition ${sound.enabled ? 'border-ember/50 bg-ember/10 text-ember' : 'border-line text-muted hover:text-ink'}`}
            title={sound.enabled && !sound.unlocked ? 'Browsers play sound only after a click on the page' : undefined}
          >
            {!sound.enabled ? '🔇 Sound off' : sound.unlocked ? '🔊 Sound on' : '🔊 Click to enable sound'}
          </button>
          <span className="font-display flex items-center gap-2 text-sm font-bold text-flame">
            <span className="live-dot" /> {liveCount} LIVE
          </span>
          <span className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-1 font-mono text-xl tabular-nums text-ember glow-ember">{formatTime(clock, tz)}</span>
        </div>
      </header>
      <ErrorNote message={error} />

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        <main className="min-h-0 flex-1">
          {live.length === 0 ? (
            <NothingLive next={upNext[0]} data={data} tz={tz} gameName={upNext[0] ? gameOf(upNext[0].tournament_game_id)?.name : undefined} />
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
                      game={gameOf(m.tournament_game_id)}
                      burst={bursts.get(m.id)}
                      now={clock}
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
                <span key={i} className={`h-1.5 w-8 rounded-full ${i === page % pages.length ? 'bg-ember shadow-[0_0_10px_#ff2a4a]' : 'bg-white/15'}`} />
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
  game,
  burst,
  now,
  showTournament,
}: {
  match: Match;
  data: LiveData;
  big: boolean;
  compact: boolean;
  totalRounds: number;
  gameName: string;
  game?: Game;
  burst?: Burst;
  now: number;
  showTournament: boolean;
}) {
  const a = match.team_a_id ? data.teams.get(match.team_a_id) : undefined;
  const b = match.team_b_id ? data.teams.get(match.team_b_id) : undefined;
  const final = isFinal(match);
  const done = match.status === 'completed';
  const scored = !!game && game.scoring !== 'none';
  const avatar = big ? 140 : compact ? 56 : 84;
  const lost = (id: string | null) => done && !!match.winner_id && match.winner_id !== id;
  // Only a fresh point plays, so a card paging back in doesn't replay an old one.
  const hit = burst && !done && now - burst.at < BURST_MS ? burst : undefined;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.85, rotateX: -20 }}
      animate={{ opacity: 1, scale: 1, rotateX: 0 }}
      exit={{ opacity: 0, scale: 0.6, rotate: -4, filter: 'blur(10px)', transition: { duration: 0.45 } }}
      transition={{ type: 'spring', stiffness: 220, damping: 24 }}
      className={`panel scanlines relative flex min-h-[220px] flex-col overflow-hidden p-0 ${done || final ? 'neon-gold' : 'neon-live'}`}
    >
      {game?.cover_url && <img src={game.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20 blur-[2px]" />}
      <div className={`relative flex items-center gap-4 overflow-hidden border-b border-line px-4 ${big ? 'py-5' : compact ? 'py-2' : 'py-3.5'}`}>
        {game?.cover_url && (
          <>
            <img src={game.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#050505] via-[#050505]/75 to-[#050505]/20" />
          </>
        )}
        <GameBadge name={gameName} url={game?.cover_url} size={big ? 96 : compact ? 44 : 68} />
        <div className="relative min-w-0 flex-1">
          <div
            className={`chrome-text font-display truncate font-black uppercase leading-none tracking-wider ${big ? 'text-6xl' : compact ? 'text-xl' : 'text-4xl'}`}
          >
            {gameName}
          </div>
          <div className={`hud mt-1.5 truncate text-ember glow-ember ${big ? 'text-base' : 'text-xs'}`}>
            {matchLabel(match, totalRounds)}
            {game && ` · ${game.team_size === 1 ? '1v1' : `${game.team_size}v${game.team_size}`}`}
            {game?.scoring === 'rounds' && ` · Bo${game.best_of}`}
            {match.station ? ` · Station ${match.station}` : ''}
            {showTournament && ` · ${data.tournaments.get(match.tournament_id)?.name ?? ''}`}
          </div>
        </div>
        <span
          className={`hud relative flex shrink-0 items-center gap-2 self-start rounded-full border px-2.5 py-0.5 text-xs ${
            done ? 'border-gold/70 bg-gold/15 text-gold' : 'border-flame/60 bg-flame/10 text-flame'
          }`}
        >
          {!done && <span className="live-dot" style={{ width: 8, height: 8 }} />} {done ? (final ? 'CHAMPION' : 'FULL TIME') : final ? 'FINAL' : 'LIVE'}
        </span>
      </div>

      <div className="relative flex flex-1 items-center justify-around gap-2 px-3">
        <Side name={a?.name ?? 'TBD'} url={a?.logo_url} size={avatar} big={big} compact={compact} dim={lost(match.team_a_id)} hit={hit?.side === 'a' ? hit.at : undefined} />
        {scored ? (
          <Score match={match} game={game!} big={big} compact={compact} />
        ) : (
          <span className={`glitch font-display font-black text-flame glow-flame italic ${big ? 'text-7xl' : compact ? 'text-2xl' : 'text-5xl'}`} data-text="VS">
            VS
          </span>
        )}
        <Side name={b?.name ?? 'TBD'} url={b?.logo_url} size={avatar} big={big} compact={compact} dim={lost(match.team_b_id)} hit={hit?.side === 'b' ? hit.at : undefined} />
      </div>

      <AnimatePresence>
        {hit && game && <PointBurst key={hit.at} side={hit.side} label={game.scoring === 'rounds' ? 'Round' : 'Goal'} big={big} compact={compact} />}
      </AnimatePresence>

      <div className="hud relative flex items-center justify-between border-t border-line bg-black/25 px-4 py-2 text-xs text-muted">
        <span>{done ? 'Match over' : match.started_at ? 'Playing for' : ''}</span>
        {match.started_at && !done && (
          <span className={`font-mono text-ember glow-ember ${big ? 'text-3xl' : 'text-xl'}`}>
            <Elapsed since={match.started_at} />
          </span>
        )}
      </div>

      <AnimatePresence>{done && <CardWinner match={match} data={data} champion={final} big={big} compact={compact} />}</AnimatePresence>
    </motion.div>
  );
}

/** Live score between the two sides; best-of games also show round pips. */
function Score({ match, game, big, compact }: { match: Match; game: Game; big: boolean; compact: boolean }) {
  const sa = match.score_a ?? 0;
  const sb = match.score_b ?? 0;
  const need = game.scoring === 'rounds' && game.best_of ? roundsToWin(game.best_of) : 0;
  const size = big ? 'text-8xl' : compact ? 'text-3xl' : 'text-6xl';
  const pips = (won: number) =>
    need > 0 && (
      <div className="flex gap-1">
        {Array.from({ length: need }, (_, i) => (
          <span
            key={i}
            className={`${compact ? 'h-1.5 w-3' : 'h-2 w-5'} -skew-x-12 ${i < won ? 'bg-ember shadow-[0_0_8px_#ff2a4a]' : 'bg-white/15'}`}
          />
        ))}
      </div>
    );
  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`font-display flex items-center font-black tabular-nums ${size}`}>
        <Digit value={sa} />
        <span className="px-2 text-flame glow-flame">:</span>
        <Digit value={sb} />
      </div>
      {need > 0 && (
        <div className="flex items-center gap-3">
          {pips(sa)}
          <span className="hud text-[10px] text-muted">FIRST TO {need}</span>
          {pips(sb)}
        </div>
      )}
    </div>
  );
}

/** A score digit that flashes when it changes. */
function Digit({ value }: { value: number }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={value}
        className="inline-block text-ink"
        style={{ textShadow: '0 0 18px rgba(255,42,74,0.8)' }}
        initial={{ y: -30, opacity: 0, scale: 1.6, color: '#ffc93c' }}
        animate={{ y: 0, opacity: 1, scale: 1, color: '#fff0f1' }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        {value}
      </motion.span>
    </AnimatePresence>
  );
}

/** Winner announcement played inside the finished match's card before it leaves the board. */
function CardWinner({ match, data, champion, big, compact }: { match: Match; data: LiveData; champion: boolean; big: boolean; compact: boolean }) {
  const winner = match.winner_id ? data.teams.get(match.winner_id) : undefined;
  const accent = '#ffc93c';
  const hasScore = match.score_a != null && match.score_b != null;
  const ws = match.winner_id === match.team_a_id ? match.score_a : match.score_b;
  const ls = match.winner_id === match.team_a_id ? match.score_b : match.score_a;
  return (
    <motion.div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 overflow-hidden text-center backdrop-blur-md"
      style={{ background: `radial-gradient(circle at center, ${accent}33, transparent 65%), rgba(10,4,3,0.97)` }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="absolute inset-y-0 w-1/2"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}40, transparent)` }}
        initial={{ x: '-150%' }}
        animate={{ x: '250%' }}
        transition={{ duration: 1.2, ease: 'easeInOut' }}
      />
      <Particles color={accent} count={champion ? 50 : 26} spread={big ? 500 : compact ? 160 : 280} />
      <motion.div
        className="font-display relative font-black uppercase leading-none"
        style={{ color: accent, textShadow: `0 0 24px ${accent}, 0 0 50px ${accent}88`, fontSize: big ? '6rem' : compact ? '1.6rem' : '3.2rem' }}
        initial={{ scale: 2.6, opacity: 0, letterSpacing: '0.5em' }}
        animate={{ scale: 1, opacity: 1, letterSpacing: '0.08em' }}
        transition={{ delay: 0.25, type: 'spring', stiffness: 180, damping: 14 }}
      >
        <Glitch text={champion ? 'Champion' : 'Winner'} />
      </motion.div>
      <motion.div
        className="relative flex items-center gap-3"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.7, type: 'spring' }}
      >
        <Avatar name={winner?.name ?? '?'} url={winner?.logo_url} size={big ? 110 : compact ? 36 : 64} ring={accent} />
        <div className="text-left">
          <div className={`font-display font-bold ${big ? 'text-5xl' : compact ? 'text-base' : 'text-2xl'}`} style={{ textShadow: `0 0 16px ${accent}aa` }}>
            {winner?.name ?? 'Winner'}
          </div>
          {hasScore && (
            <div className={`font-display text-ember ${big ? 'text-3xl' : compact ? 'text-sm' : 'text-xl'}`}>
              {ws} – {ls}
            </div>
          )}
        </div>
      </motion.div>
      {champion && !compact && (
        <motion.div className="relative text-5xl" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 1.1, type: 'spring' }}>
          🏆
        </motion.div>
      )}
    </motion.div>
  );
}

/** Square game artwork, or the game's initials in a neon tile when it has none. */
function GameBadge({ name, url, size }: { name: string; url?: string | null; size: number }) {
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  return url ? (
    <img src={url} alt={name} className="relative shrink-0 rounded-xl border border-ember/50 object-cover shadow-[0_0_18px_rgba(255,42,74,0.35)]" style={{ width: size, height: size }} />
  ) : (
    <div
      className="font-display relative flex shrink-0 items-center justify-center rounded-xl border border-flame/60 bg-gradient-to-br from-flame/30 to-ember/20 font-black text-white shadow-[0_0_18px_rgba(255,30,45,0.35)]"
      style={{ width: size, height: size, fontSize: size * 0.32 }}
    >
      {initials}
    </div>
  );
}

/** One player or team on a live card; `hit` (the time of a point they just scored) bumps the avatar. */
function Side({
  name,
  url,
  size,
  big,
  compact,
  dim,
  hit,
}: {
  name: string;
  url?: string | null;
  size: number;
  big: boolean;
  compact: boolean;
  dim?: boolean;
  hit?: number;
}) {
  return (
    <div className={`flex min-w-0 flex-1 flex-col items-center gap-2 text-center transition ${dim ? 'opacity-30 grayscale' : ''}`}>
      <motion.div
        key={hit ?? 'idle'}
        initial={false}
        animate={hit ? { scale: [1, 1.28, 0.94, 1], rotate: [0, -6, 4, 0] } : { scale: 1 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        style={{ filter: hit ? 'drop-shadow(0 0 22px #ffc93c)' : undefined }}
      >
        <Avatar name={name} url={url} size={size} ring={hit ? '#ffc93c' : '#ff2a4a55'} />
      </motion.div>
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
  gameOf: (tgId: string) => { name: string; cover_url?: string | null } | undefined;
  kind: 'next' | 'result';
}) {
  const name = (id: string | null) => (id ? data.teams.get(id)?.name ?? '?' : 'TBD');
  return (
    <div className="panel p-4">
      <div className="hud mb-3 text-xs text-flame glow-flame">▸ {title}</div>
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
              <span className="flex min-w-0 items-center gap-1.5 truncate">
                {gameOf(m.tournament_game_id)?.cover_url && (
                  <img src={gameOf(m.tournament_game_id)!.cover_url!} alt="" className="h-4 w-4 shrink-0 rounded object-cover" />
                )}
                {gameOf(m.tournament_game_id)?.name}
              </span>
              <span className="font-mono text-ember">
                {kind === 'next' ? formatTime(m.scheduled_start, tz) : formatTime(m.ended_at, tz)}
              </span>
            </div>
            {kind === 'result' ? (
              <div className="truncate">
                <span className="font-bold text-gold">{name(m.winner_id)}</span>
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

function NothingLive({ next, data, tz, gameName }: { next?: Match; data: LiveData; tz: string; gameName?: string }) {
  const name = (id: string | null) => (id ? data.teams.get(id)?.name ?? '?' : 'TBD');
  return (
    <div className="panel scanlines relative flex h-full min-h-[300px] flex-col items-center justify-center gap-4 text-center">
      <div className="hud text-sm text-muted">// stand by</div>
      {next ? (
        <>
          {gameName && <div className="chrome-text font-display text-xl font-black uppercase tracking-wider sm:text-3xl">{gameName}</div>}
          <div className="font-display text-2xl text-ember glow-ember sm:text-4xl">
            {name(next.team_a_id)} <span className="text-flame">vs</span> {name(next.team_b_id)}
          </div>
          <div className="text-lg text-muted">Next match at {formatTime(next.scheduled_start, tz)}</div>
        </>
      ) : (
        <div className="font-display text-2xl text-ember glow-ember">No matches running right now</div>
      )}
    </div>
  );
}

/**
 * Remembers each match's score and reports the side that just scored, so the
 * card can animate and the board can play the point sound. The first load and
 * a match that ends on its deciding point (the win takes over) don't count.
 */
function usePointBursts(data: LiveData) {
  const seen = useRef(new Map<string, Pick<Match, 'score_a' | 'score_b' | 'status'>>());
  const [bursts, setBursts] = useState<Map<string, Burst>>(new Map());
  useEffect(() => {
    const hits: [string, Burst][] = [];
    const at = Date.now();
    for (const m of data.matches.values()) {
      const before = seen.current.get(m.id);
      seen.current.set(m.id, { score_a: m.score_a, score_b: m.score_b, status: m.status });
      if (!before || m.status !== 'live' || (before.status !== 'live' && before.status !== 'ready')) continue;
      if ((m.score_a ?? 0) > (before.score_a ?? 0)) hits.push([m.id, { side: 'a', at }]);
      else if ((m.score_b ?? 0) > (before.score_b ?? 0)) hits.push([m.id, { side: 'b', at }]);
    }
    if (hits.length === 0) return;
    playSfx('point');
    setBursts((prev) => new Map([...prev, ...hits]));
  }, [data.matches]);
  return bursts;
}

/** "+1 GOAL" / "+1 ROUND" pop with a flash and a shockwave on the side that scored. */
function PointBurst({ side, label, big, compact }: { side: 'a' | 'b'; label: string; big: boolean; compact: boolean }) {
  const x = side === 'a' ? '25%' : '75%';
  const gold = '#ffc93c';
  return (
    <motion.div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" exit={{ opacity: 0, transition: { duration: 0.3 } }}>
      <motion.div
        className="absolute inset-0"
        style={{ background: `radial-gradient(circle at ${x} 55%, ${gold}55, rgba(255,42,74,0.25) 30%, transparent 60%)` }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0] }}
        transition={{ duration: 0.9, times: [0, 0.15, 1] }}
      />
      <div className="absolute top-[55%]" style={{ left: x }}>
        <motion.span
          className="absolute rounded-full border-4"
          style={{ borderColor: gold, width: 80, height: 80, left: -40, top: -40, boxShadow: `0 0 30px ${gold}` }}
          initial={{ scale: 0.2, opacity: 1 }}
          animate={{ scale: big ? 5 : 3, opacity: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
        <Particles color={gold} count={compact ? 10 : 18} spread={big ? 220 : compact ? 70 : 130} delay={0} jitter={0.15} duration={1} />
      </div>
      <div className="absolute top-[40%] flex w-0 justify-center" style={{ left: x }}>
        <motion.div
          className="font-display whitespace-nowrap font-black uppercase"
          style={{ color: gold, textShadow: `0 0 18px ${gold}, 0 0 40px rgba(255,42,74,0.9)`, fontSize: big ? '4.5rem' : compact ? '1.3rem' : '2.4rem' }}
          initial={{ y: 30, scale: 0.4, opacity: 0 }}
          animate={{ y: [30, -10, -40, -70], scale: [0.4, 1.35, 1, 1], opacity: [0, 1, 1, 0] }}
          transition={{ duration: BURST_MS / 1000, times: [0, 0.2, 0.7, 1], ease: 'easeOut' }}
        >
          +1 {label}
        </motion.div>
      </div>
    </motion.div>
  );
}

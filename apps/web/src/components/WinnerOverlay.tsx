import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { roundName, type Match } from '@dlc/core';
import { useLookups, type LiveData } from '../lib/useLiveData';
import { Avatar } from './ui';

const SHOW_MS = 6500;
const CHAMPION_MS = 10000;

/** Queue of finished matches to announce one after another. */
export function useWinnerQueue() {
  const [queue, setQueue] = useState<Match[]>([]);
  const push = useCallback((m: Match) => setQueue((q) => (q.some((x) => x.id === m.id) ? q : [...q, m])), []);
  const shift = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { current: queue[0] ?? null, push, shift, pending: queue.length };
}

export function WinnerOverlay({ match, data, onDone }: { match: Match | null; data: LiveData; onDone: () => void }) {
  const { roundsByTg, gameOf } = useLookups(data);
  const champion = match ? !match.next_match_id : false;

  useEffect(() => {
    if (!match) return;
    const t = setTimeout(onDone, champion ? CHAMPION_MS : SHOW_MS);
    return () => clearTimeout(t);
  }, [match, champion, onDone]);

  const latest = match ? data.matches.get(match.id) ?? match : null;
  const winner = latest?.winner_id ? data.teams.get(latest.winner_id) : undefined;
  const loserId = latest ? (latest.winner_id === latest.team_a_id ? latest.team_b_id : latest.team_a_id) : null;
  const loser = loserId ? data.teams.get(loserId) : undefined;
  const game = latest ? gameOf(latest.tournament_game_id) : undefined;
  const tournament = latest ? data.tournaments.get(latest.tournament_id) : undefined;
  const total = latest ? roundsByTg.get(latest.tournament_game_id) ?? latest.round : 1;
  const accent = champion ? '#ffb000' : '#b6ff00';
  const hasScore = latest?.score_a != null && latest?.score_b != null;
  const winnerScore = latest ? (latest.winner_id === latest.team_a_id ? latest.score_a : latest.score_b) : null;
  const loserScore = latest ? (latest.winner_id === latest.team_a_id ? latest.score_b : latest.score_a) : null;

  return (
    <AnimatePresence>
      {latest && (
        <motion.div
          key={latest.id}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden scanlines cursor-pointer"
          onClick={onDone}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.5 } }}
          style={{ background: 'radial-gradient(circle at center, rgba(20,20,40,0.94), rgba(3,3,8,0.98))' }}
        >
          {/* Sweeping light beams */}
          <motion.div
            className="absolute inset-y-0 w-1/3"
            style={{ background: `linear-gradient(90deg, transparent, ${accent}33, transparent)` }}
            initial={{ x: '-120vw' }}
            animate={{ x: '120vw' }}
            transition={{ duration: 1.4, ease: 'easeInOut' }}
          />
          <Particles color={accent} count={champion ? 70 : 36} />

          <div className="relative flex flex-col items-center gap-5 px-6 text-center">
            <motion.div
              className="font-display text-sm tracking-[0.5em] text-muted uppercase sm:text-base"
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              {tournament?.name} · {game?.name} · {roundName(latest.round, total)}
            </motion.div>

            <motion.div
              className="font-display font-black uppercase leading-none"
              style={{ color: accent, textShadow: `0 0 30px ${accent}, 0 0 60px ${accent}88`, fontSize: champion ? 'clamp(3rem, 12vw, 9rem)' : 'clamp(2.5rem, 10vw, 7rem)' }}
              initial={{ scale: 3, opacity: 0, letterSpacing: '0.6em' }}
              animate={{ scale: 1, opacity: 1, letterSpacing: '0.08em' }}
              transition={{ delay: 0.5, type: 'spring', stiffness: 180, damping: 14 }}
            >
              <Glitch text={champion ? 'Champion' : 'Winner'} />
            </motion.div>

            {champion && (
              <motion.div className="text-6xl" initial={{ rotate: -30, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ delay: 1, type: 'spring' }}>
                🏆
              </motion.div>
            )}

            <motion.div
              className="flex items-center gap-5"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 1.0, type: 'spring' }}
            >
              <Avatar name={winner?.name ?? '?'} url={winner?.logo_url} size={96} ring={accent} />
              <div className="text-left">
                <div className="font-display text-3xl font-bold sm:text-5xl" style={{ textShadow: `0 0 18px ${accent}aa` }}>
                  {winner?.name ?? 'Winner'}
                </div>
                {winner && winner.members.length > 0 && <div className="text-lg text-muted">{winner.members.join(' · ')}</div>}
              </div>
            </motion.div>

            {(hasScore || loser) && (
              <motion.div className="text-xl text-muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }}>
                {hasScore ? (
                  <>
                    <span className="font-display text-ink">{winnerScore}</span> – <span className="font-display">{loserScore}</span> vs {loser?.name}
                  </>
                ) : (
                  <>defeated {loser?.name}</>
                )}
              </motion.div>
            )}

            {latest.image_url && (
              <motion.img
                src={latest.image_url}
                alt=""
                className="panel mt-2 max-h-[30vh] max-w-[80vw] object-cover"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 1.9 }}
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Glitch({ text }: { text: string }) {
  return (
    <span className="relative inline-block">
      <span className="relative z-10">{text}</span>
      <motion.span
        aria-hidden
        className="absolute inset-0 text-cyan"
        style={{ mixBlendMode: 'screen' }}
        animate={{ x: [0, -6, 4, 0], opacity: [0, 0.8, 0.5, 0] }}
        transition={{ duration: 0.35, repeat: 3, delay: 0.6 }}
      >
        {text}
      </motion.span>
      <motion.span
        aria-hidden
        className="absolute inset-0 text-pink"
        style={{ mixBlendMode: 'screen' }}
        animate={{ x: [0, 6, -4, 0], opacity: [0, 0.8, 0.5, 0] }}
        transition={{ duration: 0.35, repeat: 3, delay: 0.65 }}
      >
        {text}
      </motion.span>
    </span>
  );
}

function Particles({ color, count }: { color: string; count: number }) {
  const [parts] = useState(() =>
    Array.from({ length: count }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: 200 + Math.random() * 600,
      size: 3 + Math.random() * 7,
      delay: 0.5 + Math.random() * 0.6,
      tint: Math.random() > 0.5 ? color : Math.random() > 0.5 ? '#00f0ff' : '#ff2bd6',
    })),
  );
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="absolute"
          style={{ width: p.size, height: p.size, background: p.tint, boxShadow: `0 0 10px ${p.tint}` }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: Math.cos(p.angle) * p.dist, y: Math.sin(p.angle) * p.dist, opacity: 0, rotate: 360 }}
          transition={{ duration: 2.2, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

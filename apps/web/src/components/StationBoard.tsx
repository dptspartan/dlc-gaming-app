import type { ReactNode } from 'react';
import { formatTime, knockoutRounds, matchLabel, stationBoard, stationLabel, type Match, type StationState, type Team } from '@dlc/core';
import { Avatar, CallCountdown, Elapsed } from './ui';

interface Props {
  matches: Match[];
  stations: number;
  teams: Map<string, Team>;
  timeZone: string;
  callMinutes: number;
  gameName: (m: Match) => string;
  /** Game master per station, shown under the station number. */
  masters?: Map<number, string>;
  /** Extra controls under a station (the admin control room). */
  actions?: (s: StationState<Match>) => ReactNode;
  /** Controls beside a queued match. */
  queueActions?: (m: Match, s: StationState<Match>) => ReactNode;
  onMatchClick?: (m: Match) => void;
  /** Queued matches to show per station. */
  upNext?: number;
}

/** Every station at the venue: what is on it now and what plays there next. */
export function StationBoard({ matches, stations, teams, timeZone, callMinutes, gameName, masters, actions, queueActions, onMatchClick, upNext = 3 }: Props) {
  const board = stationBoard(matches, stations);
  const rounds = knockoutRounds(matches);
  const label = (m: Match) => `${gameName(m)} · ${matchLabel(m, rounds.get(m.tournament_game_id) ?? m.round)}`;
  const name = (id: string | null) => (id ? teams.get(id)?.name ?? '?' : 'TBD');

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {board.map((s) => {
        const m = s.current;
        const tone = m?.status === 'live' ? 'neon-live' : m?.status === 'called' ? 'neon-called' : '';
        return (
          <div key={s.station} className={`panel flex flex-col p-4 ${tone}`}>
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <div className="font-display text-2xl font-black">
                <span className="text-muted">#</span>
                {s.station}
              </div>
              <div className="min-w-0 truncate text-right text-sm text-muted">{masters?.get(s.station) ?? (masters ? 'No game master' : '')}</div>
            </div>

            {m ? (
              <button type="button" disabled={!onMatchClick} onClick={() => onMatchClick?.(m)} className="glass-card mb-3 p-3 text-left enabled:hover:border-ember">
                <div className="mb-2 flex items-center justify-between gap-2 text-sm">
                  {m.status === 'live' ? (
                    <span className="flex items-center gap-2 font-bold text-flame">
                      <span className="live-dot" style={{ width: 8, height: 8 }} /> LIVE {m.started_at && <Elapsed since={m.started_at} />}
                    </span>
                  ) : (
                    <span className="font-bold text-gold">Waiting for players</span>
                  )}
                  {m.status === 'called' && m.called_at && <CallCountdown calledAt={m.called_at} minutes={callMinutes} className="text-lg" />}
                </div>
                <div className="mb-1 truncate text-sm text-muted">
                  {label(m)}
                  {(m.stations?.length ?? 0) > 1 ? ` · ${stationLabel(m)}` : ''}
                </div>
                <Versus a={name(m.team_a_id)} b={name(m.team_b_id)} aLogo={teams.get(m.team_a_id ?? '')?.logo_url} bLogo={teams.get(m.team_b_id ?? '')?.logo_url} score={m.status === 'live' && m.score_a != null ? `${m.score_a ?? 0} : ${m.score_b ?? 0}` : null} />
              </button>
            ) : (
              <div className="mb-3 rounded-xl border border-dashed border-line p-3 text-center text-sm text-muted">Free</div>
            )}

            {actions?.(s)}

            <div className="mt-auto pt-2">
              <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Up next</div>
              {s.queue.length === 0 && <div className="text-sm text-muted">Nothing planned</div>}
              <ul className="flex flex-col gap-1">
                {s.queue.slice(0, upNext).map((q) => (
                  <li key={q.id} className="flex items-center gap-2 text-sm">
                    <span className="w-12 shrink-0 font-mono text-ember">{formatTime(q.scheduled_start, timeZone)}</span>
                    <span className="min-w-0 flex-1 truncate" title={label(q)}>
                      <span className="text-muted">{gameName(q)}</span> {name(q.team_a_id)} <span className="text-muted">v</span> {name(q.team_b_id)}
                    </span>
                    {queueActions?.(q, s)}
                  </li>
                ))}
              </ul>
              {s.queue.length > upNext && <div className="mt-1 text-xs text-muted">+{s.queue.length - upNext} more</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Versus({ a, b, aLogo, bLogo, score }: { a: string; b: string; aLogo?: string | null; bLogo?: string | null; score: string | null }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <span className="flex min-w-0 items-center gap-2">
        <Avatar name={a} url={aLogo} size={28} />
        <span className="truncate font-semibold">{a}</span>
      </span>
      <span className="font-display text-sm text-flame">{score ?? 'VS'}</span>
      <span className="flex min-w-0 items-center justify-end gap-2">
        <span className="truncate text-right font-semibold">{b}</span>
        <Avatar name={b} url={bLogo} size={28} />
      </span>
    </div>
  );
}

/** Station and time for each match still to play, soonest first. */
export function Timetable({ matches, teams, timeZone, gameName }: { matches: Match[]; teams: Map<string, Team>; timeZone: string; gameName: (m: Match) => string }) {
  const rounds = knockoutRounds(matches);
  const list = matches
    .filter((m) => !m.is_bye && m.status !== 'completed')
    .sort((a, b) => order(a) - order(b) || (a.scheduled_start ?? '9').localeCompare(b.scheduled_start ?? '9') || (a.station ?? 99) - (b.station ?? 99));
  const name = (id: string | null) => (id ? teams.get(id)?.name ?? '?' : 'TBD');
  if (list.length === 0) return <div className="py-8 text-center text-muted">Every match has been played.</div>;
  return (
    <div className="glass-card overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left">
        <thead className="text-xs tracking-wide text-muted uppercase">
          <tr className="border-b border-line">
            <th className="px-3 py-2 font-semibold">Time</th>
            <th className="px-3 py-2 font-semibold">Station</th>
            <th className="px-3 py-2 font-semibold">Game</th>
            <th className="px-3 py-2 font-semibold">Match</th>
            <th className="px-3 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {list.map((m) => (
            <tr key={m.id} className={`border-b border-line/50 last:border-0 ${m.status === 'live' ? 'bg-flame/5' : m.status === 'called' ? 'bg-gold/5' : ''}`}>
              <td className="px-3 py-2 font-mono text-ember">{m.status === 'live' ? 'now' : formatTime(m.scheduled_start, timeZone)}</td>
              <td className="px-3 py-2 font-semibold whitespace-nowrap">{stationLabel(m) || '—'}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {gameName(m)} <span className="text-sm text-muted">· {matchLabel(m, rounds.get(m.tournament_game_id) ?? m.round)}</span>
              </td>
              <td className="px-3 py-2">
                {name(m.team_a_id)} <span className="text-muted">vs</span> {name(m.team_b_id)}
              </td>
              <td className={`px-3 py-2 text-sm whitespace-nowrap ${m.status === 'live' ? 'text-flame' : m.status === 'called' ? 'text-gold' : 'text-muted'}`}>
                {m.status === 'live' ? 'Live' : m.status === 'called' ? 'Players called' : m.status === 'ready' ? 'Queued' : 'Waiting for teams'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const order = (m: Match) => (m.status === 'live' ? 0 : m.status === 'called' ? 1 : 2);

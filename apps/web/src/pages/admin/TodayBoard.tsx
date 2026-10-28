import { useMemo, useState, type ReactNode } from 'react';
import {
  addDays,
  formatDay,
  formatTime,
  localDate,
  matchLabel,
  scoreLine,
  sideName,
  stationLabel,
  zonedToUtc,
  type Match,
  type Tournament,
} from '@dlc/core';
import { CallCountdown, Elapsed, Empty, useNow } from '../../components/ui';
import { useLookups, type LiveData } from '../../lib/useLiveData';
import { MatchControl } from './MatchControl';

type StatusFilter = 'all' | 'todo' | 'live' | 'done';
const STATUS_FILTERS: [StatusFilter, string][] = [
  ['all', 'All'],
  ['todo', 'To play'],
  ['live', 'Live'],
  ['done', 'Done'],
];

const isNow = (m: Match) => m.status === 'live' || m.status === 'called';
const isDone = (m: Match) => m.status === 'completed';

/**
 * The organiser's day at a glance: every match of one day across all games,
 * live and called first, then the timeline, then results. Tap one to run it.
 */
export function TodayBoard({ tournament, data }: { tournament: Tournament; data: LiveData }) {
  const { roundsByTg, gameOf } = useLookups(data);
  const tz = tournament.timezone;
  const days = useMemo(() => Array.from({ length: Math.max(1, tournament.days) }, (_, i) => addDays(tournament.start_date, i)), [tournament]);
  // Ticks once a minute, so "Today" rolls over at midnight.
  const today = localDate(useNow(60_000), tz);
  const [day, setDay] = useState(days.includes(today) ? today : days[0]);
  const [tg, setTg] = useState<string>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [openMatch, setOpenMatch] = useState<string | null>(null);

  const all = useMemo(() => [...data.matches.values()].filter((m) => !m.is_bye), [data.matches]);
  const tgames = useMemo(() => [...data.tgames.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)), [data.tgames]);
  const team = (id: string | null) => (id ? data.teams.get(id)?.name : undefined);
  const players = (m: Match) => [sideName(m, 'a', team(m.team_a_id)), sideName(m, 'b', team(m.team_b_id))];

  // A match belongs to the day it was played, or for one still to play the day it is planned
  // (a reschedule or the end of a day can move it off its uploaded day), else its uploaded day.
  // Kept within the event's days (starting a match moves its time to "now", which can fall
  // outside them). Anything running now is always shown.
  const dayOf = (m: Match) => {
    const at = isDone(m) ? (m.ended_at ?? m.scheduled_start) : m.scheduled_start;
    const d = at ? localDate(at, tz) : (m.fixture_day ?? days[0]);
    return d < days[0] ? days[0] : d > days[days.length - 1] ? days[days.length - 1] : d;
  };
  const onDay = (m: Match) => isNow(m) || dayOf(m) === day;
  const q = query.trim().toLowerCase();
  const shown = all.filter(
    (m) =>
      onDay(m) &&
      (tg === 'all' || m.tournament_game_id === tg) &&
      (status === 'all' ||
        (status === 'todo' && (m.status === 'ready' || m.status === 'pending')) ||
        (status === 'live' && isNow(m)) ||
        (status === 'done' && isDone(m))) &&
      (!q || [...players(m), m.match_code ?? ''].some((s) => s.toLowerCase().includes(q))),
  );
  const byTime = (a: Match, b: Match) => (a.scheduled_start ?? '9').localeCompare(b.scheduled_start ?? '9') || (a.station ?? 99) - (b.station ?? 99);
  const groups: [string, Match[]][] = [
    ['Now', shown.filter(isNow).sort((a, b) => (a.status === 'live' ? 0 : 1) - (b.status === 'live' ? 0 : 1) || byTime(a, b))],
    ['Up next', shown.filter((m) => m.status === 'ready' || m.status === 'pending').sort(byTime)],
    ['Done', shown.filter(isDone).sort((a, b) => (b.ended_at ?? '').localeCompare(a.ended_at ?? ''))],
  ];
  const dayMatches = all.filter(onDay);
  const count = (f: (m: Match) => boolean) => dayMatches.filter(f).length;

  const open = openMatch ? data.matches.get(openMatch) : undefined;
  const openTg = open ? data.tgames.get(open.tournament_game_id) : undefined;
  const gameName = (m: Match) => gameOf(m.tournament_game_id)?.name ?? '';

  return (
    <div className="today-board">
      <div className="today-stats mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
        <span>
          <b className="text-flame">{count((m) => m.status === 'live')}</b> live
        </span>
        <span>
          <b className="text-gold">{count((m) => m.status === 'called')}</b> called
        </span>
        <span>
          <b className="text-ink">{count((m) => m.status === 'ready' || m.status === 'pending')}</b> to play
        </span>
        <span>
          <b className="text-ink">{count(isDone)}</b> done
        </span>
      </div>

      <div className="today-filters sticky z-20 -mx-4 mb-2 flex flex-col gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur">
        <input type="search" placeholder="Search a player or match ID" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search a player or match ID" />
        <div className="chip-row flex gap-1.5 overflow-x-auto pb-1">
          {days.length > 1 && (
            <>
              {days.map((d) => (
                <Chip key={d} on={d === day} onClick={() => setDay(d)}>
                  {d === today ? 'Today' : formatDay(zonedToUtc(d, '12:00', tz), tz)}
                </Chip>
              ))}
              <span className="mx-1 w-px shrink-0 bg-line" />
            </>
          )}
          <Chip on={tg === 'all'} onClick={() => setTg('all')}>
            All games
          </Chip>
          {tgames.map((g) => (
            <Chip key={g.id} on={tg === g.id} onClick={() => setTg(g.id)}>
              {data.games.get(g.game_id)?.name ?? 'Game'}
            </Chip>
          ))}
          <span className="mx-1 w-px shrink-0 bg-line" />
          {STATUS_FILTERS.map(([k, label]) => (
            <Chip key={k} on={status === k} onClick={() => setStatus(k)}>
              {label}
            </Chip>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <Empty>{q ? `No match with "${query}" on this day.` : 'No matches on this day.'}</Empty>
      ) : (
        groups.map(
          ([title, list]) =>
            list.length > 0 && (
              <section key={title} className="mb-2">
                <h3 className="today-group px-1 pt-3 pb-1.5 text-xs font-semibold tracking-wider text-muted uppercase">{title}</h3>
                <ul className="flex flex-col">
                  {list.map((m) => (
                    <li key={m.id}>
                      <Row m={m} label={`${gameName(m)} · ${m.match_code ? `${m.match_code} · ` : ''}${matchLabel(m, roundsByTg.get(m.tournament_game_id) ?? m.round)}`} players={players(m)} tz={tz} callMinutes={tournament.call_minutes} onOpen={() => setOpenMatch(m.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            ),
        )
      )}

      {open && openTg && (
        <MatchControl
          match={open}
          teams={data.teams}
          matches={data.matches}
          totalRounds={roundsByTg.get(open.tournament_game_id) ?? open.round}
          gameName={gameName(open)}
          game={data.games.get(openTg.game_id)}
          games={data.games}
          timeZone={tz}
          matchMinutes={openTg.match_minutes}
          callMinutes={tournament.call_minutes}
          onClose={() => setOpenMatch(null)}
        />
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`today-chip shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${on ? 'border-ink bg-ink text-bg' : 'border-line text-ink hover:border-ink/60'}`}
    >
      {children}
    </button>
  );
}

function Row({
  m,
  label,
  players,
  tz,
  callMinutes,
  onOpen,
}: {
  m: Match;
  label: string;
  players: string[];
  tz: string;
  callMinutes: number;
  onOpen: () => void;
}) {
  const [clock, meridiem] = m.scheduled_start ? formatTime(m.scheduled_start, tz).split(' ') : ['—', ''];
  const tone = m.status === 'live' ? 'today-live' : m.status === 'called' ? 'today-called' : m.status === 'completed' ? 'today-done' : '';
  const winner = m.winner_id === m.team_a_id ? 0 : m.winner_id === m.team_b_id ? 1 : -1;
  return (
    <button type="button" onClick={onOpen} className={`today-row grid w-full grid-cols-[3.75rem_1fr_auto] items-center gap-3 border-b border-line px-3 py-2.5 text-left hover:bg-white/5 ${tone}`}>
      <span className="leading-none">
        <span className="today-time font-display block text-xl">{clock}</span>
        <span className="text-[10px] font-semibold text-muted">{meridiem}</span>
      </span>
      <span className="min-w-0">
        <span className="mb-1 flex items-start gap-1.5 text-xs text-muted">
          {m.station && <span className="today-station shrink-0 rounded-sm bg-ink px-1.5 py-px text-[10px] font-bold whitespace-nowrap text-bg">{stationLabel(m).replace('Stations', 'STN').replace('Station', 'STN')}</span>}
          <span className="min-w-0 break-words">{label}</span>
        </span>
        <span className="block text-sm font-semibold break-words">
          {m.status === 'completed' && winner >= 0 ? (
            <>
              {players[winner]} <span className="font-normal text-muted">beat</span> {players[1 - winner]}
            </>
          ) : (
            <>
              {players[0]} <span className="font-normal text-muted">vs</span> {players[1]}
            </>
          )}
        </span>
      </span>
      <span className="text-right">
        {m.status === 'live' && (
          <>
            <span className="today-tape today-tape-live">Live</span>
            <span className="mt-1 block text-sm font-semibold tabular-nums">
              {m.score_a != null ? `${m.score_a} : ${m.score_b}` : m.started_at ? <Elapsed since={m.started_at} /> : null}
            </span>
          </>
        )}
        {m.status === 'called' && (
          <>
            <span className="today-tape today-tape-called">Called</span>
            {m.called_at && <CallCountdown calledAt={m.called_at} minutes={callMinutes} className="mt-1 block text-sm" />}
          </>
        )}
        {m.status === 'ready' && <span className="today-tape">Ready</span>}
        {m.status === 'pending' && <span className="today-tape">Waiting</span>}
        {m.status === 'completed' && <span className="text-sm font-semibold tabular-nums">{scoreLine(m, true) || 'Done'}</span>}
      </span>
    </button>
  );
}

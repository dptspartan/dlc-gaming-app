import { feederMatch, formatDay, formatTime, knockoutRounds, matchLabel, sideOrContenders, type Match, type Slot, type Team } from '@dlc/core';
import { Avatar, Empty, StatusPill } from './ui';

export function ScheduleList({
  matches,
  teams,
  timeZone,
  label,
  onMatchClick,
}: {
  matches: Match[];
  teams: Map<string, Team>;
  timeZone: string;
  /** Optional game name per match, for mixed lists. */
  label?: (m: Match) => string;
  onMatchClick?: (m: Match) => void;
}) {
  const totalByTg = knockoutRounds(matches);

  const list = matches
    .filter((m) => !m.is_bye)
    .sort((a, b) => (a.scheduled_start ?? '9').localeCompare(b.scheduled_start ?? '9') || a.round - b.round || a.position - b.position);
  if (list.length === 0) return <Empty>No matches scheduled yet.</Empty>;

  const days = new Map<string, Match[]>();
  for (const m of list) {
    const key = m.scheduled_start ? formatDay(m.scheduled_start, timeZone) : 'Unscheduled';
    days.set(key, [...(days.get(key) ?? []), m]);
  }
  const team = (id: string | null) => (id ? teams.get(id)?.name ?? '?' : null);
  const name = (m: Match, slot: Slot) => sideOrContenders(m, slot, matches, team);
  // A side still waiting on another match: muted, with that match's code on hover.
  const side = (m: Match, slot: Slot) => {
    const feeder = feederMatch(m, slot, matches);
    return feeder ? { className: 'italic text-muted', title: `Winner of ${feeder.match_code}` } : {};
  };

  return (
    <div className="flex flex-col gap-6">
      {[...days].map(([day, ms]) => (
        <div key={day}>
          <div className="hud mb-2 text-sm text-flame glow-flame">▸ {day}</div>
          <div className="glass-card flex flex-col divide-y divide-line">
            {ms.map((m) => (
              <div
                key={m.id}
                className={`grid grid-cols-[4rem_1fr_auto] items-center gap-3 px-3 py-2 sm:grid-cols-[4rem_9rem_1fr_auto] ${
                  onMatchClick ? 'cursor-pointer hover:bg-ember/5' : ''
                } ${m.status === 'live' ? 'bg-flame/5' : ''}`}
                onClick={() => onMatchClick?.(m)}
              >
                <span className="font-mono text-sm text-ember glow-ember">{formatTime(m.scheduled_start, timeZone)}</span>
                <span className="hidden truncate text-sm text-muted sm:block">
                  {m.match_code ? `${m.match_code} · ` : ''}
                  {label ? `${label(m)} · ` : ''}
                  {matchLabel(m, totalByTg.get(m.tournament_game_id) ?? m.round)}
                  {m.station ? ` · Stn ${m.station}` : ''}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={name(m, 'a')} url={m.team_a_id ? teams.get(m.team_a_id)?.logo_url : null} size={22} />
                  <span {...side(m, 'a')} className={`truncate ${m.winner_id && m.winner_id === m.team_a_id ? 'text-gold' : ''} ${side(m, 'a').className ?? ''}`}>{name(m, 'a')}</span>
                  <span className="text-muted">vs</span>
                  <span {...side(m, 'b')} className={`truncate ${m.winner_id && m.winner_id === m.team_b_id ? 'text-gold' : ''} ${side(m, 'b').className ?? ''}`}>{name(m, 'b')}</span>
                  <Avatar name={name(m, 'b')} url={m.team_b_id ? teams.get(m.team_b_id)?.logo_url : null} size={22} />
                </span>
                <StatusPill status={m.status} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

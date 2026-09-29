import { formatDay, formatTime, roundName, type Match, type Slot, type Team } from '@dlc/core';
import { Avatar, StatusPill } from './ui';

export interface SlotRef {
  matchId: string;
  slot: Slot;
}

interface Props {
  matches: Match[];
  teams: Map<string, Team>;
  timeZone: string;
  onMatchClick?: (m: Match) => void;
  /** Fixture editing: click a slot, then another, to swap them. */
  onSlotClick?: (ref: SlotRef) => void;
  selectedSlot?: SlotRef | null;
}

export function Bracket({ matches, teams, timeZone, onMatchClick, onSlotClick, selectedSlot }: Props) {
  if (matches.length === 0) return null;
  const total = Math.max(...matches.map((m) => m.round));
  const rounds = Array.from({ length: total }, (_, i) =>
    matches.filter((m) => m.round === i + 1).sort((a, b) => a.position - b.position),
  );

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex min-w-max gap-6">
        {rounds.map((list, i) => (
          <div key={i} className="flex w-64 flex-col">
            <div className="font-display mb-3 text-center text-xs font-bold tracking-[0.3em] text-pink uppercase">
              {roundName(i + 1, total)}
            </div>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {list.map((m) => (
                <BracketMatch
                  key={m.id}
                  match={m}
                  teams={teams}
                  timeZone={timeZone}
                  onClick={onMatchClick}
                  onSlotClick={onSlotClick}
                  selectedSlot={selectedSlot}
                  isLast={i === total - 1}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BracketMatch({
  match,
  teams,
  timeZone,
  onClick,
  onSlotClick,
  selectedSlot,
  isLast,
}: {
  match: Match;
  teams: Map<string, Team>;
  timeZone: string;
  onClick?: (m: Match) => void;
  onSlotClick?: (ref: SlotRef) => void;
  selectedSlot?: SlotRef | null;
  isLast: boolean;
}) {
  const editable = onSlotClick && !match.is_bye && (match.status === 'pending' || match.status === 'ready');
  const live = match.status === 'live';
  const border = live ? 'border-pink shadow-[0_0_16px_rgba(255,43,214,0.45)]' : isLast ? 'border-amber/60' : 'border-line';

  const row = (slot: Slot) => {
    const teamId = slot === 'a' ? match.team_a_id : match.team_b_id;
    const team = teamId ? teams.get(teamId) : undefined;
    const won = match.winner_id != null && match.winner_id === teamId;
    const lost = match.winner_id != null && teamId != null && match.winner_id !== teamId;
    const score = slot === 'a' ? match.score_a : match.score_b;
    const selected = selectedSlot?.matchId === match.id && selectedSlot.slot === slot;
    return (
      <div
        className={`flex items-center gap-2 px-2 py-1.5 ${won ? 'bg-lime/10' : ''} ${lost ? 'opacity-45' : ''} ${
          selected ? 'outline outline-2 outline-cyan' : ''
        } ${editable ? 'cursor-pointer hover:bg-cyan/10' : ''}`}
        onClick={(e) => {
          if (!editable) return;
          e.stopPropagation();
          onSlotClick!({ matchId: match.id, slot });
        }}
      >
        <Avatar name={team?.name ?? '?'} url={team?.logo_url} size={22} />
        <span className={`flex-1 truncate font-semibold ${won ? 'text-lime' : team ? '' : 'text-muted italic'}`}>
          {team?.name ?? (match.is_bye ? 'Bye' : 'TBD')}
        </span>
        {score != null && <span className="font-display text-sm">{score}</span>}
        {won && <span className="text-lime">▸</span>}
      </div>
    );
  };

  return (
    <div
      className={`border bg-surface ${border} ${onClick ? 'cursor-pointer hover:border-cyan' : ''} ${match.is_bye ? 'opacity-50' : ''}`}
      onClick={() => onClick?.(match)}
    >
      <div className="flex items-center justify-between border-b border-line/70 px-2 py-1 text-xs text-muted">
        <span>
          {match.is_bye
            ? 'Bye'
            : match.scheduled_start
              ? `${formatDay(match.scheduled_start, timeZone)} ${formatTime(match.scheduled_start, timeZone)}`
              : 'Time TBD'}
          {match.station ? ` · Stn ${match.station}` : ''}
        </span>
        {!match.is_bye && <StatusPill status={match.status} />}
      </div>
      {row('a')}
      <div className="h-px bg-line/60" />
      {row('b')}
    </div>
  );
}

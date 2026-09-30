import { formatDay, formatTime, matchLabel, type Match, type Slot, type Team } from '@dlc/core';
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

export function Bracket({ matches: all, teams, timeZone, onMatchClick, onSlotClick, selectedSlot }: Props) {
  // Group matches have their own tables; the bracket is the knockout only.
  const upper = all.filter((m) => m.stage === 'knockout');
  if (upper.length === 0) return null;
  // Loser bracket slots nobody can reach are left out.
  const lower = all.filter((m) => m.stage === 'losers' && !(m.is_bye && m.status === 'completed' && !m.team_a_id && !m.team_b_id));
  const total = Math.max(...upper.map((m) => m.round));
  const shared = { teams, timeZone, onClick: onMatchClick, onSlotClick, selectedSlot };

  if (!all.some((m) => m.stage === 'losers')) return <Rounds matches={upper} total={total} {...shared} />;
  return (
    <div className="space-y-4">
      <div className="hud text-sm text-ink">Upper bracket</div>
      <Rounds matches={upper} total={total} {...shared} />
      <div className="hud text-sm text-ink">Lower bracket</div>
      <p className="-mt-2 text-sm text-muted">A first loss drops a player down here; a second one knocks them out. The winner plays the final.</p>
      <Rounds matches={lower} total={total} {...shared} />
    </div>
  );
}

function Rounds({
  matches,
  total,
  ...shared
}: {
  matches: Match[];
  total: number;
  teams: Map<string, Team>;
  timeZone: string;
  onClick?: (m: Match) => void;
  onSlotClick?: (ref: SlotRef) => void;
  selectedSlot?: SlotRef | null;
}) {
  const rounds = [...new Set(matches.map((m) => m.round))]
    .sort((a, b) => a - b)
    .map((r) => matches.filter((m) => m.round === r).sort((a, b) => a.position - b.position));
  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex min-w-max gap-6">
        {rounds.map((list) => (
          <div key={list[0].round} className="flex w-64 flex-col">
            <div className="hud mb-3 text-center text-xs text-flame glow-flame">{matchLabel(list[0], total)}</div>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {list.map((m) => (
                <BracketMatch key={m.id} match={m} {...shared} isLast={m.stage === 'knockout' && !m.next_match_id} />
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
  const border = live ? 'neon-live' : isLast ? 'neon-gold' : '';

  const row = (slot: Slot) => {
    const teamId = slot === 'a' ? match.team_a_id : match.team_b_id;
    const team = teamId ? teams.get(teamId) : undefined;
    const won = match.winner_id != null && match.winner_id === teamId;
    const lost = match.winner_id != null && teamId != null && match.winner_id !== teamId;
    const score = slot === 'a' ? match.score_a : match.score_b;
    const selected = selectedSlot?.matchId === match.id && selectedSlot.slot === slot;
    return (
      <div
        className={`flex items-center gap-2 px-2.5 py-1.5 ${won ? 'bg-[linear-gradient(90deg,rgba(255,201,60,0.18),transparent)]' : ''} ${lost ? 'opacity-45' : ''} ${
          selected ? 'outline outline-2 outline-ember' : ''
        } ${editable ? 'cursor-pointer hover:bg-ember/10' : ''}`}
        onClick={(e) => {
          if (!editable) return;
          e.stopPropagation();
          onSlotClick!({ matchId: match.id, slot });
        }}
      >
        <Avatar name={team?.name ?? '?'} url={team?.logo_url} size={22} />
        <span className={`flex-1 truncate font-semibold ${won ? 'text-gold' : team ? '' : 'text-muted italic'}`}>
          {team?.name ?? (match.is_bye ? 'Bye' : 'TBD')}
        </span>
        {score != null && <span className="font-display text-sm">{score}</span>}
        {won && <span className="text-gold glow-gold">◆</span>}
      </div>
    );
  };

  return (
    <div
      className={`glass-card overflow-hidden transition ${border} ${onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:border-ember' : ''} ${match.is_bye ? 'opacity-45' : ''}`}
      onClick={() => onClick?.(match)}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-1.5 font-mono text-[11px] text-muted">
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

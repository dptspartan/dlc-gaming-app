import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { formatDay, formatTime, matchLabel, type Match, type Slot, type Team } from '@dlc/core';
import trophySticker from '../assets/dlc/sticker-trophy.png';
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
  const boardRef = useRef<HTMLDivElement>(null);
  const flowPaths = useFlowPaths(boardRef, matches);
  const rounds = [...new Set(matches.map((m) => m.round))]
    .sort((a, b) => a - b)
    .map((r) => matches.filter((m) => m.round === r).sort((a, b) => a.position - b.position));
  return (
    <div className="overflow-x-auto pb-4">
      <div className="bracket-board relative flex min-w-max gap-20" ref={boardRef}>
        {flowPaths.length > 0 && (
          <svg className="bracket-flow-lines" aria-hidden="true">
            {flowPaths.map((path, index) => <path key={index} className="bracket-flow-line" d={path} />)}
          </svg>
        )}
        {rounds.map((list, i) => (
          <div
            key={list[0].round}
            className={`bracket-round-column relative flex w-64 flex-col ${i < rounds.length - 1 ? 'bracket-stage-divider' : ''}`}
          >
            <div className="hud bracket-round-title mb-3 text-center text-xs text-flame glow-flame">{matchLabel(list[0], total)}</div>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {list.map((m) => {
                const isFinal = m.stage === 'knockout' && !m.next_match_id;
                return (
                  <div
                    key={m.id}
                    className={isFinal ? 'bracket-final-slot' : undefined}
                    data-bracket-match-id={m.id}
                    data-bracket-winner-id={m.winner_id ?? ''}
                    data-bracket-status={m.status}
                  >
                    <BracketMatch match={m} {...shared} isLast={isFinal} />
                    {isFinal && <img className="bracket-final-trophy" src={trophySticker} alt="" aria-hidden="true" />}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Curves from each decided match's winner row to the slot it advanced into,
 * measured from the rendered cards. Only the dlc-labs theme shows them.
 */
function useFlowPaths(boardRef: RefObject<HTMLDivElement | null>, matches: Match[]) {
  const [flowPaths, setFlowPaths] = useState<string[]>([]);

  const update = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    const cards = new Map(
      [...board.querySelectorAll<HTMLElement>('[data-bracket-match-id]')].map((card) => [card.dataset.bracketMatchId!, card]),
    );

    const next: string[] = [];
    for (const m of matches) {
      if (!m.winner_id || !m.next_match_id || !m.next_slot || m.status === 'pending') continue;
      const source = cards.get(m.id);
      const target = cards.get(m.next_match_id);
      const winningRow = source?.querySelector<HTMLElement>(`[data-bracket-team-id="${m.winner_id}"]`);
      const targetSlot = target?.querySelector<HTMLElement>(`[data-bracket-slot="${m.next_slot}"]`);
      if (!winningRow || !targetSlot) continue;

      const sourceRect = winningRow.getBoundingClientRect();
      const targetRect = targetSlot.getBoundingClientRect();
      const startX = sourceRect.right - boardRect.left;
      const startY = sourceRect.top + sourceRect.height / 2 - boardRect.top;
      const endX = targetRect.left - boardRect.left;
      const endY = targetRect.top + targetRect.height / 2 - boardRect.top;
      const handle = Math.max(12, (endX - startX) * 0.55);
      next.push(`M ${startX} ${startY} C ${startX + handle} ${startY}, ${endX - handle} ${endY}, ${endX} ${endY}`);
    }

    setFlowPaths((current) => (current.join('|') === next.join('|') ? current : next));
  }, [boardRef, matches]);

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(board);
    board.querySelectorAll<HTMLElement>('[data-bracket-match-id]').forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [boardRef, update]);

  return flowPaths;
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
        data-bracket-slot={slot}
        data-bracket-team-id={team?.id ?? ''}
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

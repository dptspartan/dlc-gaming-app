import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { formatDay, formatTime, roundName, type Match, type Slot, type Team } from '@dlc/core';
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

export function Bracket({ matches, teams, timeZone, onMatchClick, onSlotClick, selectedSlot }: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [flowPaths, setFlowPaths] = useState<string[]>([]);

  const updateFlowPaths = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;

    const boardRect = board.getBoundingClientRect();
    const cards = [...board.querySelectorAll<HTMLElement>('[data-bracket-round][data-bracket-index]')];
    const rounds = new Map<number, HTMLElement[]>();
    for (const card of cards) {
      const round = Number(card.dataset.bracketRound);
      rounds.set(round, [...(rounds.get(round) ?? []), card]);
    }

    const nextPaths: string[] = [];
    for (let round = 0; round < Math.max(...rounds.keys()); round += 1) {
      const sources = (rounds.get(round) ?? []).sort((a, b) => Number(a.dataset.bracketIndex) - Number(b.dataset.bracketIndex));
      const targets = (rounds.get(round + 1) ?? []).sort((a, b) => Number(a.dataset.bracketIndex) - Number(b.dataset.bracketIndex));

      sources.forEach((source, sourceIndex) => {
        const winnerId = source.dataset.bracketWinnerId;
        if (!winnerId || source.dataset.bracketStatus === 'pending') return;

        const winningRow = [...source.querySelectorAll<HTMLElement>('[data-bracket-team-id]')]
          .find((row) => row.dataset.bracketTeamId === winnerId);
        const target = targets[Math.floor(sourceIndex / 2)];
        const targetSlot = target?.querySelector<HTMLElement>(`[data-bracket-slot="${sourceIndex % 2 === 0 ? 'a' : 'b'}"]`);
        if (!winningRow || !target || !targetSlot) return;

        const sourceRect = winningRow.getBoundingClientRect();
        const targetRect = targetSlot.getBoundingClientRect();
        const startX = sourceRect.right - boardRect.left;
        const startY = sourceRect.top + sourceRect.height / 2 - boardRect.top;
        const endX = targetRect.left - boardRect.left;
        const endY = targetRect.top + targetRect.height / 2 - boardRect.top;
        const handle = Math.max(12, (endX - startX) * 0.55);
        nextPaths.push(`M ${startX} ${startY} C ${startX + handle} ${startY}, ${endX - handle} ${endY}, ${endX} ${endY}`);
      });
    }

    setFlowPaths((current) => current.join('|') === nextPaths.join('|') ? current : nextPaths);
  }, []);

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    updateFlowPaths();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateFlowPaths);
    observer.observe(board);
    board.querySelectorAll<HTMLElement>('[data-bracket-round][data-bracket-index]').forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [matches, updateFlowPaths]);

  if (matches.length === 0) return null;
  const total = Math.max(...matches.map((m) => m.round));
  const rounds = Array.from({ length: total }, (_, i) =>
    matches.filter((m) => m.round === i + 1).sort((a, b) => a.position - b.position),
  );

  return (
    <div className="overflow-x-auto pb-4">
      <div className="bracket-board relative flex min-w-max gap-20" ref={boardRef}>
        {flowPaths.length > 0 && (
          <svg className="bracket-flow-lines" aria-hidden="true">
            {flowPaths.map((path, index) => <path key={index} className="bracket-flow-line" d={path} />)}
          </svg>
        )}
        {rounds.map((list, i) => (
          <div key={i} className={`bracket-round-column relative flex w-64 flex-col ${i < total - 1 ? 'bracket-stage-divider' : ''}`}>
            <div className="hud bracket-round-title mb-3 text-center text-xs text-flame glow-flame">
              {roundName(i + 1, total)}
            </div>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {list.map((m, matchIndex) => (
                <div
                  key={m.id}
                  className={i === total - 1 && matchIndex === 0 ? 'bracket-final-slot' : undefined}
                  data-bracket-round={i}
                  data-bracket-index={matchIndex}
                  data-bracket-winner-id={m.winner_id ?? ''}
                  data-bracket-status={m.status}
                >
                  <BracketMatch
                    match={m}
                    teams={teams}
                    timeZone={timeZone}
                    onClick={onMatchClick}
                    onSlotClick={onSlotClick}
                    selectedSlot={selectedSlot}
                    isLast={i === total - 1}
                  />
                  {i === total - 1 && matchIndex === 0 && <img className="bracket-final-trophy" src={trophySticker} alt="" aria-hidden="true" />}
                </div>
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

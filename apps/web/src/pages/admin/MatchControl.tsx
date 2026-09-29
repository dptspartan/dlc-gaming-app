import { useState } from 'react';
import { fromZonedInput, roundName, roundsToWin, scoringLabel, toZonedInput, type Game, type Match, type Team } from '@dlc/core';
import { Avatar, Button, Elapsed, ErrorNote, Field, StatusPill } from '../../components/ui';
import { endMatch, reopenMatch, scorePoint, startMatch } from '../../lib/admin';
import { supabase, uploadImage } from '../../lib/supabase';

interface Props {
  match: Match;
  teams: Map<string, Team>;
  totalRounds: number;
  gameName: string;
  game?: Game;
  timeZone: string;
  matchMinutes: number;
  onClose: () => void;
}

/** Start, finish, correct and annotate one match. */
export function MatchControl({ match, teams, totalRounds, gameName, game, timeZone, matchMinutes, onClose }: Props) {
  const a = match.team_a_id ? teams.get(match.team_a_id) : undefined;
  const b = match.team_b_id ? teams.get(match.team_b_id) : undefined;
  const [winner, setWinner] = useState<string | null>(match.winner_id);
  const scoring = game?.scoring ?? 'none';
  const [start, setStart] = useState(toZonedInput(match.scheduled_start, timeZone));
  const [station, setStation] = useState(match.station?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, close = false) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (close) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const canEnd = (match.status === 'live' || match.status === 'ready') && a && b;
  const sa = match.score_a ?? 0;
  const sb = match.score_b ?? 0;
  const point = (side: 'a' | 'b', delta: 1 | -1) => run(() => scorePoint(match.id, side, delta));
  const editableTime = match.status === 'pending' || match.status === 'ready';

  const saveTime = () =>
    run(async () => {
      const startDate = fromZonedInput(start, timeZone);
      const duration = match.scheduled_start && match.scheduled_end
        ? new Date(match.scheduled_end).getTime() - new Date(match.scheduled_start).getTime()
        : matchMinutes * 60_000;
      const { error } = await supabase
        .from('matches')
        .update({
          scheduled_start: startDate.toISOString(),
          scheduled_end: new Date(startDate.getTime() + duration).toISOString(),
          station: num(station),
        })
        .eq('id', match.id);
      if (error) throw new Error(error.message);
    });

  const upload = (file: File) =>
    run(async () => {
      const url = await uploadImage(file, `matches/${match.id}`);
      const { error } = await supabase.from('matches').update({ image_url: url }).eq('id', match.id);
      if (error) throw new Error(error.message);
    });

  const side = (team: Team | undefined, id: string | null) => (
    <button
      type="button"
      disabled={!canEnd || !id || scoring !== 'none'}
      onClick={() => setWinner(id)}
      className={`glass-card flex flex-1 flex-col items-center gap-2 p-4 transition ${winner && winner === id ? 'neon-win' : ''} ${
        canEnd && id ? 'hover:border-ember' : ''
      }`}
    >
      <Avatar name={team?.name ?? 'TBD'} url={team?.logo_url} size={56} />
      <span className="font-display text-center font-bold">{team?.name ?? 'TBD'}</span>
      {team && team.members.length > 0 && <span className="text-center text-xs text-muted">{team.members.join(', ')}</span>}
      {winner && winner === id && <span className="font-display text-xs text-gold">WINNER</span>}
      {match.status === 'completed' && match.winner_id === id && scoring !== 'none' && <span className="font-display text-xs text-gold">WINNER</span>}
    </button>
  );

  const scoreButtons = (side: 'a' | 'b', value: number) =>
    canEnd && (
      <div className="mt-2 flex items-center justify-center gap-2">
        <Button variant="ghost" disabled={busy || value === 0 || match.status !== 'live'} onClick={() => point(side, -1)} aria-label="Take back a point">
          −
        </Button>
        <Button disabled={busy} onClick={() => point(side, 1)}>
          {scoring === 'rounds' ? '+ Round' : '+ Goal'}
        </Button>
      </div>
    );

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="panel glass-strong max-h-[92vh] w-full max-w-xl overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="hud text-xs text-flame glow-flame">
              {gameName} · {roundName(match.round, totalRounds)}
            </div>
            <div className="mt-1 flex items-center gap-3">
              <StatusPill status={match.status} />
              {match.status === 'live' && match.started_at && <Elapsed since={match.started_at} />}
            </div>
          </div>
          <button onClick={onClose} className="text-2xl text-muted hover:text-ink" aria-label="Close">
            ×
          </button>
        </div>

        {game && (
          <div className="hud mb-3 text-xs text-muted">
            {scoringLabel(game)}
            {scoring === 'rounds' && game.best_of ? ` · first to ${roundsToWin(game.best_of)} wins, the match ends by itself` : ''}
            {scoring === 'goals' ? ' · ending the match picks the higher score' : ''}
          </div>
        )}

        {scoring === 'none' ? (
          <div className="flex items-stretch gap-3">
            {side(a, match.team_a_id)}
            <span className="font-display self-center text-xl text-flame">VS</span>
            {side(b, match.team_b_id)}
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
            <div>
              {side(a, match.team_a_id)}
              {scoreButtons('a', sa)}
            </div>
            <div className="font-display self-center pt-2 text-5xl font-black tabular-nums text-ember glow-ember">
              {sa}
              <span className="px-2 text-flame">:</span>
              {sb}
            </div>
            <div>
              {side(b, match.team_b_id)}
              {scoreButtons('b', sb)}
            </div>
          </div>
        )}

        <ErrorNote message={error} />

        <div className="mt-5 flex flex-wrap gap-2">
          {match.status === 'ready' && (
            <Button disabled={busy} onClick={() => run(() => startMatch(match.id))}>
              Start match
            </Button>
          )}
          {canEnd && scoring === 'none' && (
            <Button variant="success" disabled={busy || !winner} onClick={() => run(() => endMatch(match.id, winner!), true)}>
              {winner ? 'End & set winner' : 'Pick a winner'}
            </Button>
          )}
          {canEnd && scoring === 'goals' && (
            <Button variant="success" disabled={busy || sa === sb} onClick={() => run(() => endMatch(match.id), true)}>
              {sa === sb ? 'Level, add the deciding goal' : `End match, ${sa > sb ? a?.name : b?.name} wins`}
            </Button>
          )}
          {match.status === 'completed' && !match.is_bye && (
            <Button variant="danger" disabled={busy} onClick={() => confirm('Undo this result?') && run(() => reopenMatch(match.id))}>
              Reopen result
            </Button>
          )}
          {match.status === 'pending' && <span className="text-muted">Waiting for earlier matches to finish.</span>}
        </div>

        {!match.is_bye && (
          <div className="mt-6 border-t border-line pt-4">
            <Field label="Match photo">
              <input type="file" accept="image/*" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </Field>
            {match.image_url && <img src={match.image_url} alt="" className="mt-3 max-h-48 border border-line object-cover" />}
          </div>
        )}

        {editableTime && (
          <div className="mt-6 grid grid-cols-[1fr_6rem_auto] items-end gap-3 border-t border-line pt-4">
            <Field label={`Start time (${timeZone})`}>
              <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Station">
              <input type="number" min={1} value={station} onChange={(e) => setStation(e.target.value)} />
            </Field>
            <Button variant="ghost" disabled={busy || !start} onClick={saveTime}>
              Save
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import {
  allowsPenalties,
  currentLeg,
  feederOf,
  fromZonedInput,
  isSeries,
  leader,
  legGameId,
  lineupEditable,
  matchLabel,
  placementOf,
  roundsToWin,
  scoreSteps,
  scoreUnit,
  scoringLabel,
  stationLabel,
  toZonedInput,
  type Game,
  type Match,
  type Slot,
  type Team,
} from '@dlc/core';
import { Avatar, Button, CallCountdown, Elapsed, ErrorNote, Field, StatusPill } from '../../components/ui';
import { callMatch, endMatch, endOnPenalties, okToCall, reopenMatch, replacePlayer, scorePoint, startMatch, uncallMatch } from '../../lib/admin';
import { supabase, uploadImage } from '../../lib/supabase';

interface Props {
  match: Match;
  teams: Map<string, Team>;
  /** Every match, to tell who is free to come into this one. */
  matches: Map<string, Match>;
  totalRounds: number;
  gameName: string;
  game?: Game;
  /** Every game, for series whose legs are played on different games. */
  games: Map<string, Game>;
  timeZone: string;
  matchMinutes: number;
  /** Minutes called players have to reach their station. */
  callMinutes: number;
  onClose: () => void;
}

/** Start, finish, correct and annotate one match. */
export function MatchControl({ match, teams, matches, totalRounds, gameName, game: ownGame, games, timeZone, matchMinutes, callMinutes, onClose }: Props) {
  const a = match.team_a_id ? teams.get(match.team_a_id) : undefined;
  const b = match.team_b_id ? teams.get(match.team_b_id) : undefined;
  const [winner, setWinner] = useState<string | null>(match.winner_id);
  const series = isSeries(match);
  const leg = currentLeg(match);
  // The leg being played decides how it is scored.
  const game = ownGame ? games.get(legGameId(match, leg, ownGame.id)) ?? ownGame : undefined;
  const scoring = game?.scoring ?? 'none';
  const legName = (id: string) => games.get(id)?.name ?? '';
  const [start, setStart] = useState(toZonedInput(match.scheduled_start, timeZone));
  const [station, setStation] = useState(match.station?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shootout, setShootout] = useState({ a: '', b: '' });

  const run = async (fn: () => Promise<unknown>, close = false) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setWinner(null);
      if (close) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const canEnd = (match.status === 'live' || match.status === 'ready' || match.status === 'called') && a && b;
  const sa = match.score_a ?? 0;
  const sb = match.score_b ?? 0;
  const point = (side: 'a' | 'b', delta: number) => run(() => scorePoint(match, side, delta));
  const ahead = game ? leader(game, sa, sb) : null;
  const pens = game && allowsPenalties(game);
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
          stations: num(station) ? [num(station)] : null,
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

  const side = (team: Team | undefined, id: string | null) => {
    // A finished match marks its result; a winner-only match marks the admin's pick.
    const won = !!id && (match.status === 'completed' ? match.winner_id === id : scoring === 'none' && winner === id);
    const lost = match.status === 'completed' && !!id && !won;
    return (
      <button
        type="button"
        disabled={!canEnd || !id || scoring !== 'none'}
        onClick={() => setWinner(id)}
        className={`glass-card flex w-full min-w-0 flex-1 flex-col items-center gap-2 p-4 transition ${won ? 'neon-win' : ''} ${
          lost ? 'opacity-50' : ''
        } ${canEnd && id && scoring === 'none' ? 'hover:border-ember' : ''}`}
      >
        <Avatar name={team?.name ?? 'TBD'} url={team?.logo_url} size={56} />
        <span className="font-display w-full truncate text-center font-bold">{team?.name ?? 'TBD'}</span>
        {team && team.members.length > 0 && <span className="text-center text-xs text-muted">{team.members.join(', ')}</span>}
        {won && <span className="font-display text-xs text-gold">WINNER</span>}
      </button>
    );
  };

  const scoreButtons = (side: 'a' | 'b', value: number) =>
    canEnd &&
    game &&
    (scoring === 'rounds' ? (
      <div className="mt-2 flex items-center justify-center gap-2">
        <Button variant="ghost" disabled={busy || value === 0 || match.status !== 'live'} onClick={() => point(side, -1)} aria-label="Take back a round">
          −
        </Button>
        <Button disabled={busy} onClick={() => point(side, 1)} className="whitespace-nowrap">
          + {scoreUnit(game, 1)}
        </Button>
      </div>
    ) : (
      <ScoreAdder side={side} value={value} game={game} busy={busy} live={match.status === 'live'} onAdd={(n) => point(side, n)} />
    ));

  const rule =
    scoring === 'rounds' && game?.best_of
      ? ` · first to ${roundsToWin(game.best_of)} wins, the ${series ? 'leg' : 'match'} ends by itself`
      : scoring === 'goals' && game
        ? game.score_target
          ? ` · the ${series ? 'leg' : 'match'} ends when a side reaches ${game.score_target}`
          : ` · ending the ${series ? 'leg' : 'match'} picks the ${game.low_wins ? 'lower' : 'higher'} score`
        : '';

  return (
    <div className="match-sheet-backdrop fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      {/* A bottom sheet on phones (buttons within thumb reach), a dialog on wider screens. */}
      <div className="match-sheet panel glass-strong max-h-[88vh] w-full max-w-xl overflow-y-auto p-5 max-sm:rounded-b-none" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto -mt-2 mb-3 h-1.5 w-11 rounded-full bg-white/20 sm:hidden" aria-hidden="true" />
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="hud text-xs text-flame glow-flame">
              {gameName} · {matchLabel(match, totalRounds)}
            </div>
            <div className="mt-1 flex items-center gap-3">
              <StatusPill status={match.status} />
              {match.status === 'live' && match.started_at && <Elapsed since={match.started_at} />}
              {match.status === 'called' && match.called_at && <CallCountdown calledAt={match.called_at} minutes={callMinutes} />}
              {match.station && <span className="font-semibold">{stationLabel(match)}</span>}
            </div>
          </div>
          <button onClick={onClose} className="-mr-2 grid h-11 w-11 shrink-0 place-items-center text-2xl text-muted hover:text-ink" aria-label="Close">
            ×
          </button>
        </div>

        {series && (
          <div className="mb-3 rounded-lg border border-line bg-black/25 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">
                Best of {match.best_of}
                {match.status !== 'completed' && ` · leg ${leg + 1}: ${game?.name ?? ''}`}
              </span>
              <span className="font-display text-xl text-ember">
                {match.series_a} – {match.series_b}
              </span>
            </div>
            {match.legs.length > 0 && (
              <ol className="mt-2 flex flex-col gap-0.5 text-sm text-muted">
                {match.legs.map((l, i) => (
                  <li key={i}>
                    Leg {i + 1} · {legName(l.game_id)} · {teams.get(l.winner_id)?.name ?? '?'} won{l.score_a != null ? ` ${l.score_a}–${l.score_b}` : ''}
                    {l.pen_a != null ? ` (${l.pen_a}–${l.pen_b} pens)` : ''}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {game && (
          <div className="hud mb-3 text-xs text-muted">
            {scoringLabel(game)}
            {rule}
          </div>
        )}

        {scoring === 'none' ? (
          <div className="flex items-stretch gap-3">
            {side(a, match.team_a_id)}
            <span className="font-display self-center text-xl text-flame">VS</span>
            {side(b, match.team_b_id)}
          </div>
        ) : (
          <>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-3">
            <div className="flex flex-col">
              {side(a, match.team_a_id)}
              {scoring === 'rounds' && scoreButtons('a', sa)}
            </div>
            <div className="font-display self-center pt-2 text-center text-5xl font-black tabular-nums text-ember glow-ember">
              {sa}
              <span className="px-2 text-flame">:</span>
              {sb}
              {match.pen_a != null && <div className="mt-1 text-sm font-semibold text-muted">{match.pen_a}–{match.pen_b} pens</div>}
            </div>
            <div className="flex flex-col">
              {side(b, match.team_b_id)}
              {scoring === 'rounds' && scoreButtons('b', sb)}
            </div>
          </div>
          {/* Score buttons get the full width under the players: a kills game has several per side. */}
          {scoring === 'goals' && canEnd && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {scoreButtons('a', sa)}
              {scoreButtons('b', sb)}
            </div>
          )}
          </>
        )}

        <ErrorNote message={error} />

        <div className="sheet-actions mt-5 flex flex-wrap gap-2">
          {match.status === 'ready' && match.station && a && b && (
            <Button disabled={busy} onClick={() => okToCall(match, timeZone) && run(() => callMatch(match, match.station!))}>
              Call players to station {match.station}
            </Button>
          )}
          {(match.status === 'ready' || match.status === 'called') && (
            <Button variant={match.status === 'called' ? 'primary' : 'ghost'} disabled={busy} onClick={() => run(() => startMatch(match))}>
              Start match
            </Button>
          )}
          {match.status === 'called' && (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => run(() => uncallMatch(match, 10), true)}>
                Skip 10 min
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => run(() => uncallMatch(match, 0), true)}>
                Cancel call
              </Button>
            </>
          )}
          {canEnd && scoring === 'none' && (
            <Button variant="success" disabled={busy || !winner} onClick={() => run(() => endMatch(match, winner!), !series)}>
              {!winner ? 'Pick a winner' : series ? `End leg ${leg + 1}` : 'End & set winner'}
            </Button>
          )}
          {canEnd && scoring === 'goals' && (
            <Button variant="success" disabled={busy || !ahead} onClick={() => run(() => endMatch(match), !series)}>
              {!ahead
                ? `Level: add the deciding ${scoreUnit(game!, 1).toLowerCase()}${pens ? ', or decide on penalties' : ''}`
                : `End ${series ? `leg ${leg + 1}` : 'match'}, ${ahead === 'a' ? a?.name : b?.name} wins`}
            </Button>
          )}
          {match.status === 'completed' && !match.is_bye && (
            <Button variant="danger" disabled={busy} onClick={() => confirm('Undo this result?') && run(() => reopenMatch(match))}>
              Reopen result
            </Button>
          )}
          {match.status === 'live' && match.legs.length > 0 && (
            <Button variant="ghost" disabled={busy} onClick={() => confirm('Undo the last leg?') && run(() => reopenMatch(match))}>
              Undo last leg
            </Button>
          )}
          {match.status === 'pending' && <span className="text-muted">Waiting for earlier matches to finish.</span>}
        </div>

        {canEnd && pens && sa === sb && match.status === 'live' && (
          <PenaltyShootout
            names={[a!.name, b!.name]}
            value={shootout}
            onChange={setShootout}
            busy={busy}
            label={series ? `leg ${leg + 1}` : 'match'}
            onFinish={(pa, pb) => run(() => endOnPenalties(match, pa, pb), !series)}
          />
        )}

        {canEnd && (series || scoring !== 'none') && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm text-muted">
            <span>No-show? Give the {series ? 'series' : 'match'} to</span>
            {[a, b].map((t) => (
              <Button key={t!.id} variant="ghost" disabled={busy} onClick={() => confirm(`${t!.name} wins by walkover?`) && run(() => endMatch(match, t!.id, true), true)}>
                {t!.name}
              </Button>
            ))}
          </div>
        )}

        {lineupEditable(match) && <ChangePlayers match={match} teams={teams} matches={matches} busy={busy} run={run} />}

        {!match.is_bye && (
          <div className="mt-6 border-t border-line pt-4">
            <Field label="Match photo">
              <input type="file" accept="image/*" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </Field>
            {match.image_url && <img src={match.image_url} alt="" className="mt-3 max-h-48 border border-line object-cover" />}
          </div>
        )}

        {editableTime && (
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)_5rem_auto] items-end gap-3 border-t border-line pt-4">
            <Field label={`Start time (${timeZone})`}>
              <input type="datetime-local" className="w-full min-w-0" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Station">
              <input type="number" min={1} value={station} onChange={(e) => setStation(e.target.value)} />
            </Field>
            <Button variant="ghost" disabled={busy || !start} onClick={saveTime}>
              Save
            </Button>
            <p className="col-span-3 text-sm text-muted">
              The next timetable rebuild picks a new time. To play this match sooner or later for good, use Earlier / Later in the control room timetable.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Swap a player in a match that has not started: a late sign-up takes the
 * place, or a player still waiting for their first match swaps with them.
 */
function ChangePlayers({
  match,
  teams,
  matches,
  busy,
  run,
}: {
  match: Match;
  teams: Map<string, Team>;
  matches: Map<string, Match>;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [pick, setPick] = useState<Record<Slot, string>>({ a: '', b: '' });
  const all = [...matches.values()];
  const inMatch = [match.team_a_id, match.team_b_id];
  const others = [...teams.values()]
    .filter((t) => t.tournament_game_id === match.tournament_game_id && !inMatch.includes(t.id))
    .map((t) => ({ team: t, at: placementOf(t.id, match.tournament_game_id, all) }))
    .sort((x, y) => x.team.name.localeCompare(y.team.name));
  const free = others.filter((o) => o.at.kind === 'free');
  const waiting = others.filter((o) => o.at.kind === 'waiting');

  const row = (slot: Slot) => {
    const id = slot === 'a' ? match.team_a_id : match.team_b_id;
    const name = id ? teams.get(id)?.name ?? '?' : null;
    const feeder = feederOf(match, slot, all);
    const chosen = others.find((o) => o.team.id === pick[slot]);
    if (feeder) {
      return (
        <p key={slot} className="text-sm text-muted">
          {name ?? 'This place'} comes from {feeder.match_code ?? 'an earlier match'}. Change the players there instead.
        </p>
      );
    }
    const replace = () => {
      if (!chosen) return;
      const swap = chosen.at.kind === 'waiting' ? ` ${chosen.team.name} leaves ${chosen.at.match.match_code ?? 'their match'}${name ? ` and ${name} takes their place there` : ''}.` : '';
      if (!confirm(`Put ${chosen.team.name} in ${name ? `place of ${name}` : 'this match'}?${swap}`)) return;
      void run(async () => {
        await replacePlayer(match, slot, chosen.team.id);
        setPick((p) => ({ ...p, [slot]: '' }));
      });
    };
    return (
      <div key={slot} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <Field label={name ? `Replace ${name} with` : 'Put in the empty place'}>
          <select className="w-full min-w-0" value={pick[slot]} onChange={(e) => setPick((p) => ({ ...p, [slot]: e.target.value }))} disabled={busy}>
            <option value="">Pick a player…</option>
            {free.length > 0 && (
              <optgroup label="Not in a match yet">
                {free.map((o) => (
                  <option key={o.team.id} value={o.team.id}>
                    {o.team.name}
                  </option>
                ))}
              </optgroup>
            )}
            {waiting.length > 0 && (
              <optgroup label="Swap with a player waiting to play">
                {waiting.map((o) => (
                  <option key={o.team.id} value={o.team.id}>
                    {o.team.name} ({o.at.kind === 'waiting' ? o.at.match.match_code ?? 'another match' : ''})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
        <Button variant="ghost" disabled={busy || !chosen} onClick={replace} className="min-h-11">
          Replace
        </Button>
      </div>
    );
  };

  return (
    <div className="change-players mt-6 flex flex-col gap-3 border-t border-line pt-4">
      <div className="text-sm font-semibold">Change players</div>
      {row('a')}
      {row('b')}
      <p className="text-sm text-muted">To take a player out of the game, use Withdraw next to their name in Setup → Games &amp; players.</p>
    </div>
  );
}

/**
 * One side's score buttons in a score game: a button per quick-add amount
 * ("+1 Kill", "+5", "+10") and a box for any other amount, which "−" takes off.
 */
function ScoreAdder({
  side,
  value,
  game,
  busy,
  live,
  onAdd,
}: {
  side: 'a' | 'b';
  value: number;
  game: Game;
  busy: boolean;
  live: boolean;
  onAdd: (n: number) => void;
}) {
  const [amount, setAmount] = useState('');
  const steps = scoreSteps(game);
  const n = Number(amount);
  const valid = amount.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 9999;
  const add = (delta: number) => {
    onAdd(delta);
    setAmount('');
  };
  return (
    <div className="score-adder flex min-w-0 flex-col gap-2">
      {steps.map((step, i) =>
        i === 0 ? (
          <Button key={step} disabled={busy} onClick={() => onAdd(step)} className="min-h-11 w-full whitespace-nowrap px-2">
            +{step} {scoreUnit(game, step)}
          </Button>
        ) : null,
      )}
      {steps.length > 1 && (
        <div className="flex gap-2">
          {steps.slice(1).map((step) => (
            <Button key={step} variant="ghost" disabled={busy} onClick={() => onAdd(step)} className="min-h-11 flex-1 px-0">
              +{step}
            </Button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_2.75rem] gap-1.5">
        <input
          inputMode="numeric"
          maxLength={4}
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && valid && add(n)}
          placeholder="Any"
          aria-label={`Amount for side ${side.toUpperCase()}`}
          className="w-full min-w-0 px-2"
        />
        <Button variant="ghost" disabled={busy || !valid} onClick={() => add(n)} aria-label="Add the amount" className="min-h-11 px-0 text-base">
          +
        </Button>
        <Button
          variant="ghost"
          disabled={busy || !live || value === 0 || (valid && n > value)}
          onClick={() => add(valid ? -n : -1)}
          aria-label={valid ? 'Take the amount off' : 'Take one off'}
          className="min-h-11 px-0 text-base"
        >
          −
        </Button>
      </div>
    </div>
  );
}

/** A level goals match decided on penalties: both shoot-out scores, the higher one wins. */
function PenaltyShootout({
  names,
  value,
  onChange,
  busy,
  label,
  onFinish,
}: {
  names: [string, string];
  value: { a: string; b: string };
  onChange: (v: { a: string; b: string }) => void;
  busy: boolean;
  label: string;
  onFinish: (a: number, b: number) => void;
}) {
  const pa = value.a === '' ? null : Number(value.a);
  const pb = value.b === '' ? null : Number(value.b);
  const valid = pa != null && pb != null && Number.isInteger(pa) && Number.isInteger(pb) && pa >= 0 && pb >= 0 && pa !== pb;
  const winner = valid ? (pa! > pb! ? names[0] : names[1]) : null;
  return (
    <div className="penalties mt-4 border-t border-line pt-3">
      <div className="mb-2 text-sm font-semibold">Penalties</div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <Field label={names[0]}>
          <input type="number" inputMode="numeric" min={0} max={30} value={value.a} onChange={(e) => onChange({ ...value, a: e.target.value })} />
        </Field>
        <span className="pb-2 text-muted">–</span>
        <Field label={names[1]}>
          <input type="number" inputMode="numeric" min={0} max={30} value={value.b} onChange={(e) => onChange({ ...value, b: e.target.value })} />
        </Field>
      </div>
      {pa != null && pb != null && pa === pb && <p className="mt-2 text-sm text-amber">A shoot-out needs a winner: the penalties can't be level.</p>}
      <Button className="mt-3 w-full" disabled={busy || !valid} onClick={() => valid && onFinish(pa!, pb!)}>
        {winner ? `Finish ${label} on penalties, ${winner} wins` : `Enter the penalties to finish the ${label}`}
      </Button>
    </div>
  );
}

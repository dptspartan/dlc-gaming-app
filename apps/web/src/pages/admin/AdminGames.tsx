import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { scoringLabel, type Game, type Scoring } from '@dlc/core';
import { Avatar, Button, ErrorNote, Field, Heading, Panel } from '../../components/ui';
import { must, supabase, uploadImage } from '../../lib/supabase';

export function AdminGames() {
  const [games, setGames] = useState<Game[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    supabase
      .from('games')
      .select('*')
      .order('name')
      .then((r) => setGames(must(r) as Game[]))
      .then(undefined, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
      <div>
        <Heading sub="Games you can add to any tournament.">Game catalog</Heading>
        <ErrorNote message={error} />
        <div className="flex flex-col gap-3">
          {games.map((g) => (
            <GameRow key={g.id} game={g} onChange={load} />
          ))}
        </div>
      </div>
      <GameForm onSaved={load} />
    </div>
  );
}

function GameRow({ game, onChange }: { game: Game; onChange: () => void }) {
  const [edit, setEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (edit) return <GameForm game={game} onSaved={() => (setEdit(false), onChange())} onCancel={() => setEdit(false)} />;

  const remove = async () => {
    if (!confirm(`Delete ${game.name}?`)) return;
    const { error } = await supabase.from('games').delete().eq('id', game.id);
    if (error) setError(error.message.includes('foreign key') ? 'This game is used in a tournament, remove it there first.' : error.message);
    else onChange();
  };

  return (
    <div className="panel flex items-center gap-4">
      <Avatar name={game.name} url={game.cover_url} size={48} />
      <div className="flex-1">
        <div className="font-display font-bold">{game.name}</div>
        <div className="text-sm text-muted">
          {game.team_size === 1 ? 'Solo (1 player per side)' : `${game.team_size} players per side`} · ~{game.default_match_minutes} min per match · {scoringLabel(game)}
        </div>
        <ErrorNote message={error} />
      </div>
      <Button variant="ghost" onClick={() => setEdit(true)}>
        Edit
      </Button>
      <Button variant="danger" onClick={remove}>
        Delete
      </Button>
    </div>
  );
}

function GameForm({ game, onSaved, onCancel }: { game?: Game; onSaved: () => void; onCancel?: () => void }) {
  const [name, setName] = useState(game?.name ?? '');
  const [teamSize, setTeamSize] = useState(game?.team_size ?? 1);
  const [minutes, setMinutes] = useState(game?.default_match_minutes ?? 20);
  const [mode, setMode] = useState<Mode>(game ? modeOf(game) : 'none');
  const scoring: Scoring = mode === 'score' || mode === 'score-low' ? 'goals' : mode;
  const [bestOf, setBestOf] = useState(game?.best_of ?? 5);
  const [label, setLabel] = useState(game?.score_label ?? '');
  const [steps, setSteps] = useState((game?.score_steps ?? [1]).join(', '));
  const [target, setTarget] = useState(game?.score_target?.toString() ?? '');
  const [penalties, setPenalties] = useState(game?.penalties ?? true);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const cover_url = file ? await uploadImage(file, 'games') : game?.cover_url ?? null;
      const score = mode === 'score' || mode === 'score-low';
      const stepList = parseSteps(steps);
      const row = {
        name,
        team_size: teamSize,
        default_match_minutes: minutes,
        cover_url,
        scoring,
        best_of: scoring === 'rounds' ? bestOf : null,
        score_label: scoring !== 'none' && label.trim() ? label.trim() : null,
        // One point a tap is the default, so it is not stored.
        score_steps: score && stepList.join() !== '1' ? stepList : null,
        score_target: mode === 'score' && target ? Number(target) : null,
        low_wins: mode === 'score-low',
        penalties: score ? penalties : true,
      };
      const { error } = game ? await supabase.from('games').update(row).eq('id', game.id) : await supabase.from('games').insert(row);
      if (error) throw new Error(error.message);
      if (!game) {
        setName('');
        setFile(null);
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <div className="hud mb-4 text-sm text-flame glow-flame">{game ? 'Edit game' : 'Add game'}</div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Name">
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Tekken 8" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Players per side" hint="1 = solo">
            <input type="number" min={1} max={50} required value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))} />
          </Field>
          <Field label="Minutes per match">
            <input type="number" min={1} required value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Live scoring" hint={scoringHelp[mode]}>
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="none">Winner only (pick the winner)</option>
            <option value="rounds">Rounds (best of, ends by itself)</option>
            <option value="score">Score, higher wins (goals, kills, points)</option>
            <option value="score-low">Score, lower wins (time, strokes)</option>
          </select>
        </Field>
        {scoring !== 'none' && (
          <Field label={scoring === 'rounds' ? 'A round is called' : 'The score is counted in'} hint="Shown on the buttons and the live board">
            <input
              value={label}
              maxLength={24}
              list="score-labels"
              onChange={(e) => setLabel(e.target.value)}
              placeholder={scoring === 'rounds' ? 'Rounds' : 'Goals'}
            />
            <datalist id="score-labels">
              {(scoring === 'rounds' ? ['Rounds', 'Maps', 'Games', 'Sets'] : mode === 'score-low' ? ['Seconds', 'Strokes', 'Deaths'] : ['Goals', 'Kills', 'Points', 'Runs', 'Laps']).map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </Field>
        )}
        {scoring === 'rounds' && (
          <Field label="Best of" hint={`First to ${Math.floor(bestOf / 2) + 1} ${(label.trim() || 'rounds').toLowerCase()} wins`}>
            <select value={bestOf} onChange={(e) => setBestOf(Number(e.target.value))}>
              {[1, 3, 5, 7, 9, 11, 13].map((n) => (
                <option key={n} value={n}>
                  Best of {n}
                </option>
              ))}
            </select>
          </Field>
        )}
        {scoring === 'goals' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quick add buttons" hint="Up to 4, e.g. 1, 5, 10. Any amount can be typed too.">
                <input value={steps} inputMode="numeric" onChange={(e) => setSteps(e.target.value)} placeholder="1" />
              </Field>
              {mode === 'score' && (
                <Field label="First to (optional)" hint="Reaching it ends the match">
                  <input type="number" min={1} max={100000} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="No target" />
                </Field>
              )}
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={penalties} onChange={(e) => setPenalties(e.target.checked)} />
              A level score can be decided on penalties
            </label>
          </>
        )}
        <Field label="Cover image">
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <ErrorNote message={error} />
        <div className="flex gap-2">
          <Button disabled={busy}>{game ? 'Save' : 'Add game'}</Button>
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Panel>
  );
}

/** How a game is scored, as the form offers it: score games that lower wins are their own choice. */
type Mode = Exclude<Scoring, 'goals'> | 'score' | 'score-low';
const modeOf = (g: Game): Mode => (g.scoring === 'goals' ? (g.low_wins ? 'score-low' : 'score') : g.scoring);

/** "1, 5, 10" as [1, 5, 10]: whole numbers from 1 to 999, at most four. */
function parseSteps(text: string): number[] {
  const steps = [...new Set(text.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 999))].sort((a, b) => a - b).slice(0, 4);
  return steps.length ? steps : [1];
}

const scoringHelp: Record<Mode, string> = {
  none: 'No score is shown; the admin picks the winner.',
  score: 'Tally both sides live (goals, kills, points); ending the match picks the higher score, or it ends itself at the target.',
  'score-low': 'Enter each side\'s total (a time, strokes); ending the match picks the lower one.',
  rounds: 'Add each round won; the match ends by itself at a majority.',
};

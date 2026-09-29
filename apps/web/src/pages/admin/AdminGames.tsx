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
  const [scoring, setScoring] = useState<Scoring>(game?.scoring ?? 'none');
  const [bestOf, setBestOf] = useState(game?.best_of ?? 5);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const cover_url = file ? await uploadImage(file, 'games') : game?.cover_url ?? null;
      const row = { name, team_size: teamSize, default_match_minutes: minutes, cover_url, scoring, best_of: scoring === 'rounds' ? bestOf : null };
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
        <Field label="Live scoring" hint={scoringHelp[scoring]}>
          <select value={scoring} onChange={(e) => setScoring(e.target.value as Scoring)}>
            <option value="none">Off (pick the winner)</option>
            <option value="goals">Goals (higher score wins)</option>
            <option value="rounds">Rounds (best of)</option>
          </select>
        </Field>
        {scoring === 'rounds' && (
          <Field label="Best of" hint={`First to ${Math.floor(bestOf / 2) + 1} rounds wins`}>
            <select value={bestOf} onChange={(e) => setBestOf(Number(e.target.value))}>
              {[1, 3, 5, 7, 9, 11, 13].map((n) => (
                <option key={n} value={n}>
                  Best of {n}
                </option>
              ))}
            </select>
          </Field>
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

const scoringHelp: Record<Scoring, string> = {
  none: 'No score is shown; the admin picks the winner.',
  goals: 'Tally both sides live; ending the match picks the higher score.',
  rounds: 'Add each round won; the match ends by itself at a majority.',
};

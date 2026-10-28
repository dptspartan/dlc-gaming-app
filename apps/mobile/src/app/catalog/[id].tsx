import type { Game, Scoring } from '@dlc/core';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { Avatar, Button, Choices, colors, ErrorText, Field, Screen, styles } from '../../components/ui';
import { pickAndUpload } from '../../lib/photo';
import { supabase } from '../../lib/supabase';

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
  'score-low': "Enter each side's total (a time, strokes); ending the match picks the lower one.",
  rounds: 'Add each round won; the match ends by itself at a majority.',
};

/** Add a game to the catalog, or edit or delete one (id "new" adds). */
export default function GameForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const [game, setGame] = useState<Game | null>(null);
  const [name, setName] = useState('');
  const [teamSize, setTeamSize] = useState('1');
  const [minutes, setMinutes] = useState('20');
  const [mode, setMode] = useState<Mode>('none');
  const [bestOf, setBestOf] = useState(5);
  const [label, setLabel] = useState('');
  const [steps, setSteps] = useState('1');
  const [target, setTarget] = useState('');
  const [penalties, setPenalties] = useState(true);
  const [cover, setCover] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scoring: Scoring = mode === 'score' || mode === 'score-low' ? 'goals' : mode;

  useEffect(() => {
    if (isNew) return;
    supabase
      .from('games')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error) return setError(error.message);
        const g = data as Game;
        setGame(g);
        setName(g.name);
        setTeamSize(String(g.team_size));
        setMinutes(String(g.default_match_minutes));
        setMode(modeOf(g));
        setBestOf(g.best_of ?? 5);
        setLabel(g.score_label ?? '');
        setSteps((g.score_steps ?? [1]).join(', '));
        setTarget(g.score_target?.toString() ?? '');
        setPenalties(g.penalties ?? true);
        setCover(g.cover_url);
      });
  }, [id, isNew]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('save', async () => {
      const size = Number(teamSize);
      const mins = Number(minutes);
      if (!name.trim()) throw new Error('Give the game a name.');
      if (!Number.isInteger(size) || size < 1 || size > 50) throw new Error('Players per side must be between 1 and 50.');
      if (!Number.isInteger(mins) || mins < 1) throw new Error('Minutes per match must be at least 1.');
      const score = mode === 'score' || mode === 'score-low';
      const stepList = parseSteps(steps);
      const row = {
        name: name.trim(),
        team_size: size,
        default_match_minutes: mins,
        cover_url: cover,
        scoring,
        best_of: scoring === 'rounds' ? bestOf : null,
        score_label: scoring !== 'none' && label.trim() ? label.trim() : null,
        // One point a tap is the default, so it is not stored.
        score_steps: score && stepList.join() !== '1' ? stepList : null,
        score_target: mode === 'score' && target ? Number(target) : null,
        low_wins: mode === 'score-low',
        penalties: score ? penalties : true,
      };
      const { error } = isNew ? await supabase.from('games').insert(row) : await supabase.from('games').update(row).eq('id', id);
      if (error) throw new Error(error.message);
      router.back();
    });

  const remove = () =>
    Alert.alert(`Delete ${name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          run('delete', async () => {
            const { error } = await supabase.from('games').delete().eq('id', id);
            if (error) throw new Error(error.message.includes('foreign key') ? 'This game is used in a tournament, remove it there first.' : error.message);
            router.back();
          }),
      },
    ]);

  if (!isNew && !game && !error) return <Screen>{null}</Screen>;
  const suggestions = scoring === 'rounds' ? ['Rounds', 'Maps', 'Games', 'Sets'] : mode === 'score-low' ? ['Seconds', 'Strokes', 'Deaths'] : ['Goals', 'Kills', 'Points', 'Runs', 'Laps'];

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'Add game' : 'Edit game' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <Field label="NAME" placeholder="Tekken 8" value={name} onChangeText={setName} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field label="PLAYERS PER SIDE" hint="1 = solo" style={{ flex: 1 }} keyboardType="number-pad" value={teamSize} onChangeText={setTeamSize} />
            <Field label="MINUTES PER MATCH" style={{ flex: 1 }} keyboardType="number-pad" value={minutes} onChangeText={setMinutes} />
          </View>
          <Choices<Mode>
            label="LIVE SCORING"
            value={mode}
            onChange={setMode}
            hint={scoringHelp[mode]}
            options={[
              ['none', 'Winner only'],
              ['rounds', 'Rounds (best of)'],
              ['score', 'Score, higher wins'],
              ['score-low', 'Score, lower wins'],
            ]}
          />
          {scoring !== 'none' && (
            <View style={{ gap: 8 }}>
              <Field
                label={scoring === 'rounds' ? 'A ROUND IS CALLED' : 'THE SCORE IS COUNTED IN'}
                hint="Shown on the buttons and the live board"
                maxLength={24}
                placeholder={scoring === 'rounds' ? 'Rounds' : 'Goals'}
                value={label}
                onChangeText={setLabel}
              />
              <Choices value={label} onChange={setLabel} options={suggestions.map((l): [string, string] => [l, l])} />
            </View>
          )}
          {scoring === 'rounds' && (
            <Choices
              label="BEST OF"
              value={bestOf}
              onChange={setBestOf}
              hint={`First to ${Math.floor(bestOf / 2) + 1} ${(label.trim() || 'rounds').toLowerCase()} wins`}
              options={[1, 3, 5, 7, 9, 11, 13].map((n): [number, string] => [n, String(n)])}
            />
          )}
          {scoring === 'goals' && (
            <>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Field label="QUICK ADD BUTTONS" hint="Up to 4, e.g. 1, 5, 10" style={{ flex: 1 }} keyboardType="numbers-and-punctuation" placeholder="1" value={steps} onChangeText={setSteps} />
                {mode === 'score' && (
                  <Field label="FIRST TO" hint="Optional; reaching it ends the match" style={{ flex: 1 }} keyboardType="number-pad" placeholder="No target" value={target} onChangeText={(v) => setTarget(v.replace(/[^0-9]/g, ''))} />
                )}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
                <Switch value={penalties} onValueChange={setPenalties} trackColor={{ true: colors.ember, false: colors.border }} />
                <Text style={[styles.text, { flex: 1 }]}>A level score can be decided on penalties</Text>
              </View>
            </>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {cover && <Avatar name={name || '?'} url={cover} size={44} />}
            <Button
              title={cover ? 'Change cover image' : 'Add a cover image'}
              variant="ghost"
              style={{ flex: 1 }}
              busy={busy === 'cover'}
              disabled={!!busy}
              onPress={() =>
                run('cover', async () => {
                  const url = await pickAndUpload('games');
                  if (url) setCover(url);
                })
              }
            />
          </View>
          <ErrorText message={error} />
          <Button title={isNew ? 'Add game' : 'Save'} busy={busy === 'save'} disabled={!!busy} onPress={save} />
          {!isNew && <Button title="Delete game" variant="danger" busy={busy === 'delete'} disabled={!!busy} onPress={remove} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

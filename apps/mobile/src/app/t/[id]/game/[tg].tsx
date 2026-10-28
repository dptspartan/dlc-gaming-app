import { describeGroupSetup, placementOf, scoringLabel, type Game, type PlanStage, type SeriesRule, type StagePlan, type Team, type TournamentGame } from '@dlc/core';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { FormatFields, formatOf, type FormatSettings } from '../../../../components/format';
import { Avatar, Button, Choices, colors, ErrorText, Field, Pill, Screen, styles } from '../../../../components/ui';
import { pickAndUpload } from '../../../../lib/photo';
import { applyPlan, withdrawPlayer } from '../../../../lib/setup';
import { supabase } from '../../../../lib/supabase';
import { useTournament, type TournamentData } from '../../../../lib/useTournament';

const BEST_OF = [1, 3, 5, 7];
const legsLabel = (n: number) => (n === 1 ? 'One game' : `Best of ${n}`);
const ROUND_NAME: Record<string, string> = { F: 'Final', SF: 'Semi-finals', QF: 'Quarter-finals' };
/** "Lower round 2" for L2, "Round of 64" for R64. */
const roundKeyName = (key: string) => ROUND_NAME[key] ?? (key.startsWith('L') ? `Lower round ${key.slice(1)}` : key.startsWith('R') ? `Round of ${key.slice(1)}` : key);

/** One game of a tournament: timing, stations, format, game plan, and its players. */
export default function TournamentGameScreen() {
  const { id, tg: tgId } = useLocalSearchParams<{ id: string; tg: string }>();
  const { data } = useTournament(id);
  const tg = data.tgames.find((x) => x.id === tgId);
  if (!tg || !data.tournament) return <Screen>{null}</Screen>;
  return <GameEditor key={tg.id} tg={tg} data={data} />;
}

function GameEditor({ tg, data }: { tg: TournamentGame; data: TournamentData }) {
  const stations = data.tournament!.stations;
  const game = data.games.get(tg.game_id);
  const teamSize = game?.team_size ?? 1;
  const noun = teamSize === 1 ? 'player' : 'team';
  const teams = [...data.teams.values()].filter((t) => t.tournament_game_id === tg.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const hasFixtures = data.matches.some((m) => m.tournament_game_id === tg.id);
  const [settings, setSettings] = useState({
    match_minutes: String(tg.match_minutes),
    buffer_minutes: String(tg.buffer_minutes),
    stations_required: String(tg.stations_required),
    // Stations the venue no longer has drop out, so saving clears them.
    allowed_stations: (tg.allowed_stations ?? []).filter((n) => n <= stations),
  });
  const [format, setFormat] = useState<FormatSettings>(formatOf(tg));
  const [plan, setPlan] = useState<StagePlan>(tg.plan ?? {});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  const formatChanged = JSON.stringify(format) !== JSON.stringify(formatOf(tg)) || !!plan.double_elim !== !!tg.plan?.double_elim;
  const dirty =
    formatChanged ||
    JSON.stringify(plan) !== JSON.stringify(tg.plan ?? {}) ||
    settings.match_minutes !== String(tg.match_minutes) ||
    settings.buffer_minutes !== String(tg.buffer_minutes) ||
    settings.stations_required !== String(tg.stations_required) ||
    settings.allowed_stations.join() !== (tg.allowed_stations ?? []).filter((n) => n <= stations).join();

  const run = async (key: string, fn: () => Promise<unknown>) => {
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
      const n = (s: string) => Number(s);
      if (![settings.match_minutes, settings.stations_required].every((s) => Number.isInteger(n(s)) && n(s) >= 1)) throw new Error('Minutes per match and stations per match must be at least 1.');
      if (!Number.isInteger(n(settings.buffer_minutes)) || n(settings.buffer_minutes) < 0) throw new Error('The break between matches must be 0 or more minutes.');
      const row = {
        match_minutes: n(settings.match_minutes),
        buffer_minutes: n(settings.buffer_minutes),
        stations_required: n(settings.stations_required),
        allowed_stations: settings.allowed_stations.length ? settings.allowed_stations : null,
        ...format,
        plan,
      };
      const { error } = await supabase.from('tournament_games').update(row).eq('id', tg.id);
      if (error) throw new Error(error.message);
      // Matches still to play take the new plan; times and stations follow the new settings.
      if (hasFixtures) await applyPlan({ ...tg, ...row, plan }, data.matches);
    });

  const remove = () =>
    Alert.alert(`Remove ${game?.name}?`, 'All its players and matches leave this tournament too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          run('remove', async () => {
            const { error } = await supabase.from('tournament_games').delete().eq('id', tg.id);
            if (error) throw new Error(error.message);
            router.back();
          }),
      },
    ]);

  const toggleStation = (n: number) =>
    setSettings((s) => ({
      ...s,
      allowed_stations: s.allowed_stations.includes(n) ? s.allowed_stations.filter((x) => x !== n) : [...s.allowed_stations, n].sort((a, b) => a - b),
    }));

  return (
    <Screen>
      <Stack.Screen options={{ title: game?.name ?? 'Game' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 64 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar name={game?.name ?? '?'} url={game?.cover_url} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.text, { fontWeight: '900', fontSize: 20 }]}>{game?.name}</Text>
              <Text style={styles.muted}>
                {teamSize === 1 ? 'Solo' : `${teamSize} players per side`} · {teams.length} {noun}s{game ? ` · ${scoringLabel(game)}` : ''}
              </Text>
            </View>
            <Pill status={tg.status.replace('_', ' ')} />
          </View>

          <View style={[styles.card, { gap: 14 }]}>
            <Text style={styles.label}>Settings</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Field label="MIN / MATCH" style={{ flex: 1 }} keyboardType="number-pad" value={settings.match_minutes} onChangeText={(v) => setSettings({ ...settings, match_minutes: v })} />
              <Field label="BREAK" style={{ flex: 1 }} keyboardType="number-pad" value={settings.buffer_minutes} onChangeText={(v) => setSettings({ ...settings, buffer_minutes: v })} />
              <Field label="STATIONS" style={{ flex: 1 }} keyboardType="number-pad" value={settings.stations_required} onChangeText={(v) => setSettings({ ...settings, stations_required: v })} />
            </View>
            <View>
              <Text style={styles.label}>PLAYS ON STATIONS</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {Array.from({ length: stations }, (_, i) => i + 1).map((n) => {
                  const on = settings.allowed_stations.includes(n);
                  return (
                    <Pressable key={n} onPress={() => toggleStation(n)} style={[styles.chip, on && styles.chipOn]}>
                      <Text style={{ color: on ? colors.text : colors.muted, fontWeight: '800', fontSize: 16 }}>{n}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.muted, { fontSize: 13, marginTop: 4 }]}>
                {settings.allowed_stations.length ? `Only ${settings.allowed_stations.join(', ')}` : 'Any free station'}
                {Number(settings.stations_required) > 1 ? ` · takes ${settings.stations_required} at once` : ''}
              </Text>
            </View>
            <FormatFields value={format} onChange={setFormat} />
            {format.format === 'groups' && <Text style={styles.muted}>{describeGroupSetup(teams.length, format.group_count, format.advance_per_group, format.wildcards)}</Text>}
          </View>

          <PlanEditor plan={plan} onChange={setPlan} groups={format.format === 'groups'} ownGame={tg.game_id} games={[...data.games.values()]} />

          {formatChanged && hasFixtures && (
            <Text style={{ color: colors.gold }}>Save, then regenerate the fixtures{format.format === 'groups' ? ' (or rebuild the knockout)' : ''} for the new format to take effect.</Text>
          )}
          {dirty && hasFixtures && <Text style={styles.muted}>Matches not started yet take the new settings and legs; live and finished ones keep theirs.</Text>}
          <Button title={dirty ? 'Save settings & game plan' : 'Saved'} busy={busy === 'save'} disabled={!!busy || !dirty} onPress={save} />
          <ErrorText message={error} />

          <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 }}>
            <Text style={styles.label}>
              {teamSize === 1 ? 'Players' : 'Teams'} ({teams.length})
            </Text>
            {hasFixtures && (
              <Text style={[styles.muted, { marginTop: -4 }]}>
                Fixtures exist. A {noun} added now is not in a match yet: open a match that hasn&apos;t started and use Change players, or withdraw someone and pick them to take
                that place.
              </Text>
            )}
            {teams.map((t) => (
              <TeamRow
                key={t.id}
                team={t}
                tg={tg}
                teams={teams}
                data={data}
                hasFixtures={hasFixtures}
                withdrawing={withdrawing === t.id}
                onWithdraw={() => setWithdrawing(withdrawing === t.id ? null : t.id)}
                onError={setError}
              />
            ))}
          </View>

          <AddTeam tg={tg} teamSize={teamSize} />

          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 }}>
            <Button title={`Remove ${game?.name ?? 'game'} from this tournament`} variant="danger" busy={busy === 'remove'} disabled={!!busy} onPress={remove} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** The whole game plan: a best-of series per stage, and the games a final is played on. */
function PlanEditor({ plan, onChange, groups, ownGame, games }: { plan: StagePlan; onChange: (p: StagePlan) => void; groups: boolean; ownGame: string; games: Game[] }) {
  const own = games.find((g) => g.id === ownGame);
  // Legs of a final can be any game with the same players per side.
  const legOptions = games.filter((g) => g.team_size === own?.team_size).sort((a, b) => a.name.localeCompare(b.name));
  const set = (stage: PlanStage, rule: SeriesRule) => onChange({ ...plan, [stage]: rule });
  const double = !!plan.double_elim;
  const stages: [PlanStage, string][] = [
    ...(groups ? [['group', 'GROUP MATCHES'] as [PlanStage, string]] : []),
    ['knockout', double ? 'UPPER ROUNDS' : groups ? 'KNOCKOUT ROUNDS' : 'EARLY ROUNDS'],
    ['semi', double ? 'UPPER FINAL' : 'SEMI-FINALS'],
    ...(double ? [['losers', 'LOSER BRACKET'] as [PlanStage, string]] : []),
    ['final', 'FINAL'],
  ];
  const final = plan.final ?? { best_of: 1 };
  const roundRules = Object.entries(plan.rounds ?? {});
  const legs = Array.from({ length: final.best_of }, (_, i) => final.games?.[i] ?? null);

  return (
    <View style={[styles.card, { gap: 14 }]}>
      <Text style={styles.label}>Game plan</Text>
      <Choices
        label="KNOCKOUT"
        value={double ? 'double' : 'single'}
        onChange={(v) => onChange({ ...plan, double_elim: v === 'double' })}
        options={[
          ['single', 'Single elimination'],
          ['double', 'With loser bracket'],
        ]}
        hint={double ? 'A first knockout loss drops a player into the loser bracket; a second knocks them out.' : undefined}
      />
      {stages.map(([stage, label]) => {
        const rule = plan[stage] ?? (stage === 'semi' || stage === 'losers' ? plan.knockout : undefined) ?? { best_of: 1 };
        return (
          <Choices
            key={stage}
            label={label}
            value={rule.best_of}
            onChange={(best_of) => set(stage, stage === 'final' ? { best_of, games: final.games?.slice(0, best_of) } : { best_of })}
            options={BEST_OF.map((n): [number, string] => [n, legsLabel(n)])}
          />
        );
      })}
      {roundRules.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={styles.muted}>
            Rounds with their own legs (set on Fixtures): {roundRules.map(([key, rule]) => `${roundKeyName(key)} ${legsLabel(rule.best_of).toLowerCase()}`).join(', ')}
          </Text>
          <Button title="Use the stage legs instead" variant="ghost" onPress={() => onChange({ ...plan, rounds: undefined })} />
        </View>
      )}
      {final.best_of > 1 &&
        legs.map((g, i) => (
          <Choices
            key={i}
            label={`FINAL LEG ${i + 1}`}
            value={g ?? ownGame}
            onChange={(v) => {
              const next = [...legs];
              next[i] = v === ownGame ? null : v;
              set('final', { best_of: final.best_of, games: next });
            }}
            options={legOptions.map((o): [string, string] => [o.id, `${o.name} (${scoringLabel(o).toLowerCase()})`])}
          />
        ))}
    </View>
  );
}

function TeamRow({
  team,
  tg,
  teams,
  data,
  hasFixtures,
  withdrawing,
  onWithdraw,
  onError,
}: {
  team: Team;
  tg: TournamentGame;
  teams: Team[];
  data: TournamentData;
  hasFixtures: boolean;
  withdrawing: boolean;
  onWithdraw: () => void;
  onError: (e: string | null) => void;
}) {
  const [seed, setSeed] = useState(team.seed?.toString() ?? '');
  useEffect(() => setSeed(team.seed?.toString() ?? ''), [team.seed]);
  const free = hasFixtures && placementOf(team.id, tg.id, data.matches).kind === 'free';

  const saveSeed = async () => {
    const value = seed.trim() ? Number(seed) : null;
    if (value === team.seed) return;
    const { error } = await supabase.from('teams').update({ seed: value }).eq('id', team.id);
    onError(error?.message ?? null);
  };
  const remove = () =>
    Alert.alert(`Remove ${team.name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('teams').delete().eq('id', team.id);
          onError(error?.message ?? null);
        },
      },
    ]);

  return (
    <View style={[styles.card, { padding: 10, gap: 10 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar name={team.name} url={team.logo_url} size={34} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.text, { fontWeight: '700' }]} numberOfLines={1}>
            {team.name}
          </Text>
          {team.members.length > 0 && (
            <Text style={[styles.muted, { fontSize: 13 }]} numberOfLines={1}>
              {team.members.join(', ')}
            </Text>
          )}
          {free && <Text style={{ color: colors.gold, fontSize: 13 }}>Not in a match yet</Text>}
        </View>
        {hasFixtures ? (
          <>
            {team.seed != null && <Text style={[styles.muted, { fontSize: 13 }]}>Seed {team.seed}</Text>}
            <Button title={withdrawing ? 'Close' : 'Withdraw'} variant="ghost" style={{ paddingVertical: 10, paddingHorizontal: 12 }} onPress={onWithdraw} />
          </>
        ) : (
          <>
            <TextInput
              value={seed}
              onChangeText={(v) => setSeed(v.replace(/[^0-9]/g, ''))}
              onEndEditing={saveSeed}
              placeholder="Seed"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              style={[styles.input, { width: 70, paddingVertical: 10, textAlign: 'center' }]}
            />
            <Pressable hitSlop={8} onPress={remove} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={`Remove ${team.name}`}>
              <Text style={{ color: colors.muted, fontSize: 24 }}>×</Text>
            </Pressable>
          </>
        )}
      </View>
      {withdrawing && <Withdraw team={team} teams={teams} data={data} onDone={onWithdraw} />}
    </View>
  );
}

/** Take a player out after the fixtures are out: their matches go to a player not in a match yet, or wait with an empty place. */
function Withdraw({ team, teams, data, onDone }: { team: Team; teams: Team[]; data: TournamentData; onDone: () => void }) {
  const [replacement, setReplacement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const at = placementOf(team.id, team.tournament_game_id, data.matches);
  const free = teams.filter((t) => t.id !== team.id && placementOf(t.id, team.tournament_game_id, data.matches).kind === 'free');
  // Byes don't count as played: whoever takes the place gets the bye.
  const played = data.matches.find(
    (m) => m.tournament_game_id === team.tournament_game_id && !m.is_bye && m.status !== 'pending' && m.status !== 'ready' && (m.team_a_id === team.id || m.team_b_id === team.id),
  );
  const code = at.kind === 'free' ? null : at.match.match_code ?? 'their match';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await withdrawPlayer(team.tournament_id, team.id, replacement || null);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.muted}>
        {at.kind === 'free'
          ? `${team.name} is not in a match yet, so they just leave the game.`
          : played
            ? `${team.name} has already played or is playing ${played.match_code ?? 'a match'}, so the result needs them. To drop them from here on, end their next match as a walkover.`
            : `${team.name} plays ${code}. Pick who takes their place there, or leave it empty and fill it later from the match.`}
      </Text>
      {at.kind !== 'free' && !played && (
        <Choices
          label="WHO TAKES THEIR PLACE"
          value={replacement}
          onChange={setReplacement}
          disabled={busy}
          options={[['', 'Nobody yet'], ...free.map((t): [string, string] => [t.id, t.name])]}
        />
      )}
      <ErrorText message={error} />
      <Button
        title={replacement ? `Withdraw, ${teams.find((t) => t.id === replacement)?.name} plays instead` : `Withdraw ${team.name}`}
        variant="danger"
        busy={busy}
        disabled={!!played}
        onPress={submit}
      />
    </View>
  );
}

function AddTeam({ tg, teamSize }: { tg: TournamentGame; teamSize: number }) {
  const noun = teamSize === 1 ? 'player' : 'team';
  const [bulk, setBulk] = useState(false);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>(() => Array(teamSize).fill(''));
  const [logo, setLogo] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setMembers((m) => Array.from({ length: teamSize }, (_, i) => m[i] ?? '')), [teamSize]);

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

  const add = () =>
    run('add', async () => {
      if (bulk) {
        const rows = bulkText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((line) => {
            const [n, rest] = line.split(':');
            return { tournament_game_id: tg.id, name: n.trim(), members: rest ? rest.split(',').map((s) => s.trim()).filter(Boolean) : [] };
          });
        if (!rows.length) throw new Error(`Type one ${noun} per line.`);
        const { error } = await supabase.from('teams').insert(rows);
        if (error) throw new Error(error.message);
        setBulkText('');
      } else {
        if (!name.trim()) throw new Error(`Type the ${noun}'s name.`);
        const clean = teamSize > 1 ? members.map((m) => m.trim()).filter(Boolean) : [];
        const { error } = await supabase.from('teams').insert({ tournament_game_id: tg.id, name: name.trim(), members: clean, logo_url: logo });
        if (error) throw new Error(error.message);
        setName('');
        setMembers(Array(teamSize).fill(''));
        setLogo(null);
      }
    });

  return (
    <View style={[styles.card, { gap: 12 }]}>
      <Choices
        label={`ADD ${noun.toUpperCase()}`}
        value={bulk ? 'bulk' : 'one'}
        onChange={(v) => setBulk(v === 'bulk')}
        options={[
          ['one', 'One at a time'],
          ['bulk', 'Paste a list'],
        ]}
      />
      {bulk ? (
        <Field
          label={`ONE ${noun.toUpperCase()} PER LINE`}
          hint={teamSize > 1 ? 'Format: Team name: player 1, player 2' : 'Just the player name'}
          multiline
          value={bulkText}
          onChangeText={setBulkText}
          textAlignVertical="top"
          numberOfLines={6}
        />
      ) : (
        <>
          <Field label={teamSize === 1 ? 'PLAYER NAME / GAMERTAG' : 'TEAM NAME'} value={name} onChangeText={setName} returnKeyType="done" />
          {teamSize > 1 &&
            members.map((m, i) => <Field key={i} label={`PLAYER ${i + 1}`} value={m} onChangeText={(v) => setMembers(members.map((x, j) => (j === i ? v : x)))} />)}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {logo && <Avatar name={name || '?'} url={logo} size={40} />}
            <Button
              title={logo ? 'Change photo' : 'Add a logo / photo'}
              variant="ghost"
              style={{ flex: 1 }}
              busy={busy === 'logo'}
              disabled={!!busy}
              onPress={() =>
                run('logo', async () => {
                  const url = await pickAndUpload('teams');
                  if (url) setLogo(url);
                })
              }
            />
          </View>
        </>
      )}
      <ErrorText message={error} />
      <Button title="Add" busy={busy === 'add'} disabled={!!busy} onPress={add} />
    </View>
  );
}

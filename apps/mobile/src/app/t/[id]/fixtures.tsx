import {
  findTeamConflicts,
  formatWhen,
  groupLetter,
  groupStandings,
  knockoutRounds,
  matchLabel,
  matchRule,
  type Match,
  type Slot,
  type TimetableResult,
} from '@dlc/core';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { FitNote } from '../../../components/fitnote';
import { Button, Choices, colors, ErrorText, Pill, Screen, styles } from '../../../components/ui';
import { refreshTimetable } from '../../../lib/actions';
import { buildKnockout, generateFixtures, groupQualifiers, previewTimetable, setRoundLegs, swapSlots } from '../../../lib/setup';
import { useTournament } from '../../../lib/useTournament';

const BEST_OF = [1, 3, 5, 7];
type SlotRef = { matchId: string; slot: Slot };
const stageOrder: Record<Match['stage'], number> = { group: 0, knockout: 1, losers: 2 };

/** Build a game's fixtures, its knockout, the legs of each round, and swap players between matches. */
export default function Fixtures() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useTournament(id);
  const t = data.tournament;
  const tgames = useMemo(() => [...data.tgames].sort((a, b) => a.created_at.localeCompare(b.created_at)), [data.tgames]);
  const [tgId, setTgId] = useState<string | null>(null);
  const [view, setView] = useState<'groups' | 'knockout'>('knockout');
  const [swapMode, setSwapMode] = useState(false);
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const [result, setResult] = useState<TimetableResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tgId && tgames.length) setTgId(tgames[0].id);
  }, [tgId, tgames]);

  const tg = tgames.find((x) => x.id === tgId);
  const all = data.matches;
  const matches = useMemo(() => all.filter((m) => m.tournament_game_id === tgId), [all, tgId]);
  const teams = useMemo(() => [...data.teams.values()].filter((x) => x.tournament_game_id === tgId), [data.teams, tgId]);
  const fit = useMemo(() => (t && all.length ? previewTimetable(t, data.tgames, all, data.games.values()) : null), [t, data.tgames, all, data.games]);
  const conflicts = useMemo(() => findTeamConflicts(all), [all]);
  const total = knockoutRounds(matches).get(tgId ?? '') ?? 0;

  if (!t) return <Screen>{null}</Screen>;
  if (!tgames.length)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Fixtures' }} />
        <Text style={[styles.muted, { padding: 16 }]}>Add a game first, under Games & players.</Text>
      </Screen>
    );

  const started = matches.some((m) => m.status === 'live' || (m.status === 'completed' && !m.is_bye));
  const groupMatches = matches.filter((m) => m.stage === 'group');
  const knockout = matches.filter((m) => m.stage !== 'group');
  const hasGroups = tg?.format === 'groups' && groupMatches.length > 0;
  const groupsDone = groupMatches.length > 0 && groupMatches.every((m) => m.status === 'completed');
  const knockoutStarted = knockout.some((m) => m.status === 'live' || (m.status === 'completed' && !m.is_bye));
  const through = tg && hasGroups ? groupQualifiers(tg, teams, matches) : [];
  const shown = hasGroups && (view === 'groups' || !knockout.length) ? 'groups' : 'knockout';
  const teamName = (tid: string | null) => (tid ? data.teams.get(tid)?.name ?? '?' : 'TBD');

  const act = async (key: string, fn: () => Promise<TimetableResult | void>) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (r) setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const generate = () => {
    if (!tg) return;
    if (teams.length < 2) return setError('Add at least two players or teams first.');
    const go = () => act('generate', () => generateFixtures(t, data.tgames, tg, teams, all, data.games.values()));
    if (!matches.length) return void go();
    const uploaded = matches.filter((m) => m.round_code != null).length;
    Alert.alert(
      'Replace the fixtures?',
      uploaded ? `The ${uploaded} uploaded fixtures go, and the sheets have to be uploaded again on the web to get them back.` : 'Any edits to the current fixtures are lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: go },
      ],
    );
  };

  const startKnockout = () => {
    if (!tg) return;
    const go = () =>
      act('knockout', async () => {
        const r = await buildKnockout(t, data.tgames, tg, teams, all, data.games.values());
        setView('knockout');
        return r;
      });
    if (!knockout.length) return void go();
    Alert.alert('Rebuild the knockout?', 'It is drawn again from the current group tables.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Rebuild', style: 'destructive', onPress: go },
    ]);
  };

  const onSlot = (ref: SlotRef) => {
    if (!selected) return setSelected(ref);
    const first = selected;
    setSelected(null);
    if (first.matchId === ref.matchId && first.slot === ref.slot) return;
    void act('swap', () => swapSlots(first, ref));
  };

  const open = (m: Match) => router.push({ pathname: '/match/[id]', params: { id: m.id, tournament: id } });

  // Rounds in play order: group matchdays, the knockout, then the loser bracket.
  const rounds = (list: Match[]) => {
    const by = new Map<string, Match[]>();
    for (const m of list) {
      if (m.is_bye && m.status === 'completed' && !m.team_a_id && !m.team_b_id) continue;
      const key = `${m.stage}:${m.round_code ?? m.round}`;
      by.set(key, [...(by.get(key) ?? []), m]);
    }
    return [...by.values()]
      .map((r) => r.sort((a, b) => (a.scheduled_start ?? '9').localeCompare(b.scheduled_start ?? '9') || (a.match_code ?? '').localeCompare(b.match_code ?? '')))
      .sort((a, b) => stageOrder[a[0].stage] - stageOrder[b[0].stage] || a[0].round - b[0].round);
  };

  const legs = (round: Match[]) => {
    if (!tg || swapMode) return null;
    const first = round[0];
    const value = matchRule(tg.plan, first, total).best_of;
    const openCount = round.filter((m) => !m.is_bye && (m.status === 'pending' || m.status === 'ready' || m.status === 'called')).length;
    return (
      <Choices
        value={value}
        disabled={!!busy || openCount === 0}
        onChange={(n) => act('legs', () => setRoundLegs(tg, all, first, n))}
        options={BEST_OF.map((n): [number, string] => [n, n === 1 ? 'One game' : `Bo${n}`])}
        hint={openCount === 0 ? 'Every match in this round has started.' : undefined}
      />
    );
  };

  const slotButton = (m: Match, slot: Slot) => {
    const tid = slot === 'a' ? m.team_a_id : m.team_b_id;
    const on = selected?.matchId === m.id && selected.slot === slot;
    const locked = m.status !== 'pending' && m.status !== 'ready';
    return (
      <Pressable key={slot} disabled={locked || !!busy} onPress={() => onSlot({ matchId: m.id, slot })} style={[styles.chip, { flex: 1 }, on && styles.chipOn, locked && { opacity: 0.4 }]}>
        <Text style={{ color: on ? colors.text : colors.muted, fontWeight: '800' }} numberOfLines={1}>
          {teamName(tid)}
        </Text>
      </Pressable>
    );
  };

  const matchRow = (m: Match) => {
    const won = (tid: string | null) => m.winner_id != null && m.winner_id === tid;
    if (swapMode)
      return (
        <View key={m.id} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          {slotButton(m, 'a')}
          <Text style={styles.muted}>v</Text>
          {slotButton(m, 'b')}
        </View>
      );
    return (
      <Pressable key={m.id} onPress={() => open(m)} style={[styles.card, { padding: 10, gap: 4 }, m.status === 'live' && styles.cardLive, m.status === 'called' && styles.cardCalled]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text style={[styles.muted, { fontSize: 13, flex: 1 }]}>
            {m.match_code ? `${m.match_code} · ` : ''}
            {m.is_bye ? 'Bye' : formatWhen(m.scheduled_start, t.timezone)}
            {m.station ? ` · Station ${m.station}` : ''}
            {m.best_of > 1 ? ` · Bo${m.best_of}` : ''}
          </Text>
          <Pill status={m.status} />
        </View>
        {(['a', 'b'] as const).map((sd) => {
          const tid = sd === 'a' ? m.team_a_id : m.team_b_id;
          const from = sd === 'a' ? m.a_from : m.b_from;
          return (
            <View key={sd} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[styles.text, { fontWeight: '700', color: won(tid) ? colors.gold : tid ? colors.text : colors.muted, flex: 1 }]} numberOfLines={1}>
                {tid ? teamName(tid) : from ? `Winner of ${from}` : 'TBD'}
              </Text>
              <Text style={[styles.text, { fontWeight: '800' }]}>{m.best_of > 1 ? (sd === 'a' ? m.series_a : m.series_b) : (sd === 'a' ? m.score_a : m.score_b) ?? ''}</Text>
            </View>
          );
        })}
      </Pressable>
    );
  };

  const standings = hasGroups ? groupStandings(teams, groupMatches) : new Map();

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Fixtures' }} />
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 64 }}>
        <Choices
          value={tgId ?? ''}
          onChange={(v) => {
            setTgId(v);
            setResult(null);
            setSelected(null);
            setSwapMode(false);
          }}
          options={tgames.map((x): [string, string] => [x.id, data.games.get(x.game_id)?.name ?? 'Game'])}
        />

        {tg && (
          <View style={[styles.card, { gap: 10 }]}>
            <Text style={styles.muted}>
              {teams.length} entrants · {tg.stations_required > 1 ? `${tg.stations_required} stations per match · ` : ''}
              {tg.match_minutes} min a match{tg.buffer_minutes ? ` + ${tg.buffer_minutes} min setup` : ''}
            </Text>
            <Button
              title={matches.length ? 'Regenerate fixtures' : 'Generate fixtures'}
              busy={busy === 'generate'}
              disabled={!!busy || started}
              onPress={generate}
            />
            {started && <Text style={[styles.muted, { fontSize: 13 }]}>Matches have started, so the fixtures can't be generated again.</Text>}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                title="Rebuild timetable"
                variant="ghost"
                style={{ flex: 1 }}
                busy={busy === 'reflow'}
                disabled={!!busy || !all.length}
                onPress={() => act('reflow', () => refreshTimetable(t.id))}
              />
              <Button
                title={swapMode ? 'Done editing' : 'Edit matchups'}
                variant="ghost"
                style={[{ flex: 1 }, swapMode && { borderColor: colors.ember }]}
                disabled={!!busy || !matches.length}
                onPress={() => {
                  setSwapMode(!swapMode);
                  setSelected(null);
                  if (!swapMode && hasGroups) setView('knockout');
                }}
              />
            </View>
            {swapMode && <Text style={{ color: colors.ember }}>Tap one player, then another, to swap them. Only matches that have not started can change.</Text>}
            {hasGroups && (
              <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
                <Button
                  title={knockout.length ? 'Rebuild knockout' : 'Start knockout'}
                  variant={groupsDone && !knockout.length ? 'success' : 'ghost'}
                  busy={busy === 'knockout'}
                  disabled={!!busy || !groupsDone || knockoutStarted}
                  onPress={startKnockout}
                />
                <Text style={[styles.muted, { fontSize: 14 }]}>
                  {knockoutStarted
                    ? 'The knockout has started.'
                    : groupsDone
                      ? `Going through (best first): ${through.map(teamName).join(', ')}`
                      : `${groupMatches.filter((m) => m.status === 'completed').length} of ${groupMatches.length} group matches played. The knockout is drawn when they are all done.`}
                </Text>
              </View>
            )}
            <FitNote result={result ?? fit} tz={t.timezone} />
            {conflicts.length > 0 && (
              <Text style={{ color: colors.gold }}>
                Overlaps: {conflicts.slice(0, 5).map((c) => teamName(c.teamId)).join(', ')}
                {conflicts.length > 5 ? ` and ${conflicts.length - 5} more` : ''} {conflicts.length === 1 ? 'is' : 'are'} booked in two matches at once.
              </Text>
            )}
            <ErrorText message={error} />
          </View>
        )}

        {hasGroups && !swapMode && (
          <Choices
            value={shown}
            onChange={setView}
            options={[
              ['groups', 'Groups'],
              ['knockout', 'Knockout'],
            ]}
          />
        )}

        {matches.length === 0 ? (
          <Text style={styles.muted}>No fixtures yet. Add players, then generate the fixtures (or upload a fixtures sheet on the web).</Text>
        ) : shown === 'groups' ? (
          <>
            <Text style={styles.label}>Group matches: legs</Text>
            {legs(groupMatches)}
            {[...standings].map(([g, rows]) => (
              <View key={g} style={[styles.card, { gap: 6 }]}>
                <Text style={[styles.text, { fontWeight: '900' }]}>Group {groupLetter(g)}</Text>
                <View style={{ flexDirection: 'row' }}>
                  <Text style={[styles.muted, { flex: 1, fontSize: 12 }]}>PLAYER</Text>
                  {['P', 'W', 'L', '+/-'].map((h) => (
                    <Text key={h} style={[styles.muted, { width: 36, textAlign: 'right', fontSize: 12 }]}>
                      {h}
                    </Text>
                  ))}
                </View>
                {rows.map((r: { teamId: string; rank: number; played: number; won: number; lost: number; diff: number }) => (
                  <View key={r.teamId} style={{ flexDirection: 'row' }}>
                    <Text style={[styles.text, { flex: 1, color: through.includes(r.teamId) && groupsDone ? colors.gold : colors.text }]} numberOfLines={1}>
                      {r.rank}. {teamName(r.teamId)}
                    </Text>
                    {[r.played, r.won, r.lost, r.diff].map((v, i) => (
                      <Text key={i} style={[styles.text, { width: 36, textAlign: 'right', fontVariant: ['tabular-nums'] }]}>
                        {v}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            ))}
            {rounds(groupMatches).map((round) => (
              <View key={round[0].id} style={{ gap: 8 }}>
                <Text style={[styles.label, { marginTop: 8 }]}>Matchday {round[0].round}</Text>
                {round.map(matchRow)}
              </View>
            ))}
          </>
        ) : hasGroups && !knockout.length ? (
          <Text style={styles.muted}>The knockout is drawn from the group tables once every group match is played.</Text>
        ) : (
          rounds(swapMode ? matches : knockout).map((round) => (
            <View key={round[0].id} style={{ gap: 8 }}>
              <Text style={[styles.label, { marginTop: 8, marginBottom: 0 }]}>{round[0].stage === 'group' ? `Group matchday ${round[0].round}` : matchLabel(round[0], total)}</Text>
              {round[0].stage !== 'group' && legs(round)}
              {round.map(matchRow)}
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

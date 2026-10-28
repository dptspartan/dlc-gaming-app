import { allowsPenalties, currentLeg, isSeries, lineupEditable, knockoutRounds, leader, legGameId, matchLabel, roundsToWin, scoreSteps, scoreUnit, scoringLabel, stationLabel } from '@dlc/core';
import * as ImagePicker from 'expo-image-picker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ChangePlayers, Penalties } from '../../components/lineup';
import { RescheduleCard } from '../../components/reschedule';
import { confirmCall } from '../../components/station';
import { Avatar, Button, CallCountdown, colors, Elapsed, ErrorText, Pill, Screen, styles } from '../../components/ui';
import { callMatch, endMatch, endOnPenalties, reopenMatch, scorePoint, startMatch, uncallMatch } from '../../lib/actions';
import { supabase, uploadLocalImage } from '../../lib/supabase';
import { useTournament } from '../../lib/useTournament';

export default function MatchControl() {
  const { id, tournament } = useLocalSearchParams<{ id: string; tournament: string }>();
  const { data } = useTournament(tournament);
  const match = data.matches.find((m) => m.id === id);
  const [winner, setWinner] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState<Record<'a' | 'b', string>>({ a: '', b: '' });

  useEffect(() => {
    if (match?.winner_id) setWinner(match.winner_id);
  }, [match?.winner_id]);

  if (!match) return <Screen>{null}</Screen>;

  const tg = data.tgames.find((x) => x.id === match.tournament_game_id);
  const series = isSeries(match);
  const leg = currentLeg(match);
  // The leg being played decides how it is scored (a final can mix games).
  const game = tg ? data.games.get(legGameId(match, leg, tg.game_id)) ?? data.games.get(tg.game_id) : undefined;
  const total = knockoutRounds(data.matches).get(match.tournament_game_id) ?? match.round;
  const a = match.team_a_id ? data.teams.get(match.team_a_id) : undefined;
  const b = match.team_b_id ? data.teams.get(match.team_b_id) : undefined;
  const canEnd = (match.status === 'live' || match.status === 'ready' || match.status === 'called') && a && b;
  const scoring = game?.scoring ?? 'none';
  const sa = match.score_a ?? 0;
  const sb = match.score_b ?? 0;
  const need = scoring === 'rounds' && game?.best_of ? roundsToWin(game.best_of) : 0;
  const ahead = game ? leader(game, sa, sb) : null;
  const pens = allowsPenalties(game);

  const run = async (label: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      setWinner(null);
      after?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pickPhoto = async (camera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, allowsEditing: true };
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert('Camera permission is needed to take a photo.');
    }
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    await run('photo', async () => {
      const url = await uploadLocalImage(asset.uri, asset.mimeType, `matches/${match.id}`);
      const { error } = await supabase.from('matches').update({ image_url: url }).eq('id', match.id);
      if (error) throw new Error(error.message);
    });
  };

  const point = (side: 'a' | 'b', delta: number) =>
    run(`point-${side}${delta}`, () => scorePoint(match, side, delta));
  // A typed amount for one side (+50 kills); "Undo" takes it off instead of one.
  const typed = (side: 'a' | 'b') => {
    const n = Number(amount[side]);
    return amount[side].trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 9999 ? n : null;
  };
  const addTyped = (side: 'a' | 'b', sign: 1 | -1) => {
    const n = typed(side) ?? 1;
    setAmount((v) => ({ ...v, [side]: '' }));
    return point(side, sign * n);
  };

  const confirmEnd = () => {
    const w = scoring === 'none' ? (winner === match.team_a_id ? a : b) : ahead === 'a' ? a : b;
    const score = scoring === 'none' ? '' : ` ${ahead === 'a' ? sa : sb}–${ahead === 'a' ? sb : sa}`;
    const what = series ? `leg ${leg + 1}` : 'match';
    Alert.alert(`End ${what}?`, `${w?.name} wins${score}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: `End ${what}`,
        onPress: () => run('end', () => endMatch(match, scoring === 'none' ? winner : null), series ? undefined : () => router.back()),
      },
    ]);
  };

  const confirmWalkover = (t: typeof a) =>
    t &&
    Alert.alert(`${t.name} wins by walkover?`, `The whole ${series ? 'series' : 'match'} goes to ${t.name}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Walkover', style: 'destructive', onPress: () => run('walkover', () => endMatch(match, t.id, true), () => router.back()) },
    ]);

  const confirmReopen = () =>
    Alert.alert('Undo this result?', 'The winner is removed from the next match.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reopen', style: 'destructive', onPress: () => run('reopen', () => reopenMatch(match)) },
    ]);

  const side = (team: typeof a, tid: string | null) => {
    const picked = scoring === 'none' ? winner != null && winner === tid : match.status === 'completed' && match.winner_id === tid;
    return (
      <Pressable
        disabled={!canEnd || scoring !== 'none'}
        onPress={() => setWinner(tid)}
        style={[styles.card, { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 18 }, picked && { borderColor: colors.gold, backgroundColor: 'rgba(255,201,60,0.1)', shadowColor: colors.gold, shadowOpacity: 0.6, shadowRadius: 16, elevation: 8 }]}
      >
        <Avatar name={team?.name ?? '?'} url={team?.logo_url} size={56} />
        <Text style={[styles.text, { fontWeight: '800', textAlign: 'center' }]}>{team?.name ?? 'TBD'}</Text>
        {team && team.members.length > 0 && <Text style={[styles.muted, { fontSize: 12, textAlign: 'center' }]}>{team.members.join(', ')}</Text>}
        {picked && <Text style={{ color: colors.gold, fontWeight: '900', letterSpacing: 3, textShadowColor: colors.gold, textShadowRadius: 10 }}>WINNER</Text>}
      </Pressable>
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: `${game?.name ?? ''} · ${matchLabel(match, total)}` }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pill status={match.status} />
          {match.status === 'live' && match.started_at && <Elapsed since={match.started_at} />}
          {match.status === 'called' && match.called_at && data.tournament ? <CallCountdown calledAt={match.called_at} minutes={data.tournament.call_minutes} /> : null}
          {match.station ? <Text style={[styles.text, { fontWeight: '800' }]}>{stationLabel(match)}</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'stretch' }}>
          {side(a, match.team_a_id)}
          <Text style={{ color: colors.flame, fontWeight: '900', fontStyle: 'italic', fontSize: 24, alignSelf: 'center', textShadowColor: colors.flame, textShadowRadius: 12 }}>VS</Text>
          {side(b, match.team_b_id)}
        </View>

        {series && (
          <View style={[styles.card, { gap: 6 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[styles.text, { fontWeight: '800' }]}>
                Best of {match.best_of}
                {match.status !== 'completed' ? ` · leg ${leg + 1}: ${game?.name ?? ''}` : ''}
              </Text>
              <Text style={{ color: colors.gold, fontSize: 22, fontWeight: '900' }}>
                {match.series_a} – {match.series_b}
              </Text>
            </View>
            {match.legs.map((l, i) => (
              <Text key={i} style={styles.muted}>
                Leg {i + 1} · {data.games.get(l.game_id)?.name ?? ''} · {data.teams.get(l.winner_id)?.name ?? '?'} won{l.score_a != null ? ` ${l.score_a}–${l.score_b}` : ''}
                {l.pen_a != null ? ` (${l.pen_a}–${l.pen_b} pens)` : ''}
              </Text>
            ))}
          </View>
        )}

        {game && (
          <Text style={[styles.label, { marginBottom: 0 }]}>
            {scoringLabel(game)}
            {need ? ` · first to ${need}, ends by itself` : ''}
            {scoring === 'goals' && !game.score_target && !game.low_wins ? ' · higher score wins' : ''}
          </Text>
        )}

        {scoring !== 'none' && (
          <View style={{ alignItems: 'center', gap: 12 }}>
            <Text style={{ color: colors.text, fontSize: 64, fontWeight: '900', fontVariant: ['tabular-nums'], textShadowColor: colors.ember, textShadowRadius: 18 }}>
              {sa} <Text style={{ color: colors.flame }}>:</Text> {sb}
            </Text>
            {match.pen_a != null && <Text style={[styles.muted, { fontWeight: '800', marginTop: -8 }]}>{match.pen_a}–{match.pen_b} pens</Text>}
            {canEnd && (
              <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
                {(['a', 'b'] as const).map((sd) => {
                  const name = (sd === 'a' ? a : b)?.name ?? '';
                  const value = sd === 'a' ? sa : sb;
                  if (scoring === 'rounds' || !game) {
                    return (
                      <View key={sd} style={{ flex: 1, gap: 8 }}>
                        <Button title={`+ ${game ? scoreUnit(game, 1) : 'Round'} ${name}`} busy={busy === `point-${sd}1`} disabled={!!busy} onPress={() => point(sd, 1)} />
                        <Button title="Undo" variant="ghost" disabled={!!busy || match.status !== 'live' || value === 0} onPress={() => point(sd, -1)} />
                      </View>
                    );
                  }
                  const steps = scoreSteps(game);
                  const n = typed(sd);
                  return (
                    <View key={sd} style={{ flex: 1, gap: 8 }}>
                      <Button title={`+${steps[0]} ${scoreUnit(game, steps[0])} ${name}`} busy={busy === `point-${sd}${steps[0]}`} disabled={!!busy} onPress={() => point(sd, steps[0])} />
                      {steps.length > 1 && (
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          {steps.slice(1).map((step) => (
                            <Button key={step} title={`+${step}`} style={{ flex: 1 }} busy={busy === `point-${sd}${step}`} disabled={!!busy} onPress={() => point(sd, step)} />
                          ))}
                        </View>
                      )}
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TextInput
                          value={amount[sd]}
                          onChangeText={(t) => setAmount((v) => ({ ...v, [sd]: t.replace(/[^0-9]/g, '') }))}
                          placeholder="Amount"
                          placeholderTextColor={colors.muted}
                          keyboardType="number-pad"
                          returnKeyType="done"
                          onSubmitEditing={() => n && addTyped(sd, 1)}
                          style={[styles.input, { flex: 1, minWidth: 0, paddingHorizontal: 10 }]}
                        />
                        <Button title="Add" variant="ghost" disabled={!!busy || !n} onPress={() => addTyped(sd, 1)} />
                      </View>
                      <Button
                        title={n ? `Take off ${n}` : 'Undo 1'}
                        variant="ghost"
                        disabled={!!busy || match.status !== 'live' || value === 0 || (n != null && n > value)}
                        onPress={() => addTyped(sd, -1)}
                      />
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        <ErrorText message={error} />

        {match.status === 'ready' && match.station && a && b && (
          <Button title={`Call players to station ${match.station}`} busy={busy === 'call'} disabled={!!busy} onPress={() => confirmCall(data, match, () => run('call', () => callMatch(match, match.station!)))} />
        )}
        {(match.status === 'ready' || match.status === 'called') && (
          <Button title="Start match" variant={match.status === 'called' ? 'primary' : 'ghost'} busy={busy === 'start'} disabled={!!busy} onPress={() => run('start', () => startMatch(match))} />
        )}
        {match.status === 'called' && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Skip 10 min" variant="ghost" style={{ flex: 1 }} busy={busy === 'skip'} disabled={!!busy} onPress={() => run('skip', () => uncallMatch(match, 10), () => router.back())} />
            <Button title="Cancel call" variant="ghost" style={{ flex: 1 }} busy={busy === 'uncall'} disabled={!!busy} onPress={() => run('uncall', () => uncallMatch(match, 0), () => router.back())} />
          </View>
        )}
        {canEnd && scoring === 'none' && (
          <Button
            title={!winner ? 'Tap the winner above' : series ? `End leg ${leg + 1}` : 'End & set winner'}
            variant="success"
            disabled={!winner}
            busy={busy === 'end'}
            onPress={confirmEnd}
          />
        )}
        {canEnd && scoring === 'goals' && (
          <Button
            title={
              !ahead
                ? `Level, add the deciding ${game ? scoreUnit(game, 1).toLowerCase() : 'point'}${pens && match.status === 'live' ? ' or use penalties' : ''}`
                : series
                  ? `End leg ${leg + 1}`
                  : 'End match'
            }
            variant="success"
            disabled={!ahead}
            busy={busy === 'end'}
            onPress={confirmEnd}
          />
        )}
        {canEnd && pens && sa === sb && match.status === 'live' && (
          <Penalties
            names={[a!.name, b!.name]}
            label={series ? `leg ${leg + 1}` : 'match'}
            busy={busy === 'pens'}
            onFinish={(pa, pb) => run('pens', () => endOnPenalties(match, pa, pb), series ? undefined : () => router.back())}
          />
        )}
        {canEnd && (
          <View style={{ gap: 8 }}>
            <Text style={styles.muted}>A side didn't turn up? Give the {series ? 'series' : 'match'} to the other:</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[a, b].map((t) => (
                <Button key={t!.id} title={t!.name} variant="ghost" style={{ flex: 1 }} busy={busy === 'walkover'} disabled={!!busy} onPress={() => confirmWalkover(t)} />
              ))}
            </View>
          </View>
        )}
        {match.status === 'live' && match.legs.length > 0 && <Button title="Undo last leg" variant="ghost" busy={busy === 'reopen'} onPress={confirmReopen} />}
        {match.status === 'completed' && !match.is_bye && <Button title="Reopen result" variant="danger" busy={busy === 'reopen'} onPress={confirmReopen} />}
        {match.status === 'pending' && <Text style={styles.muted}>Waiting for the earlier matches to finish.</Text>}
        {(match.status === 'pending' || match.status === 'ready') && !match.is_bye && data.tournament && <RescheduleCard data={data} match={match} />}
        {lineupEditable(match) && <ChangePlayers match={match} data={data} busy={!!busy} run={run} />}

        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16, gap: 10 }}>
          <Text style={styles.label}>Match photo</Text>
          {match.image_url && <Image source={{ uri: match.image_url }} style={{ width: '100%', height: 200, borderRadius: 4 }} resizeMode="cover" />}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Camera" variant="ghost" style={{ flex: 1 }} busy={busy === 'photo'} onPress={() => pickPhoto(true)} />
            <Button title="Gallery" variant="ghost" style={{ flex: 1 }} busy={busy === 'photo'} onPress={() => pickPhoto(false)} />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

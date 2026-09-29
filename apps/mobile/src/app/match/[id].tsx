import { roundName } from '@dlc/core';
import * as ImagePicker from 'expo-image-picker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Avatar, Button, colors, Elapsed, ErrorText, Pill, Screen, styles } from '../../components/ui';
import { rpc, supabase, uploadLocalImage } from '../../lib/supabase';
import { useTournament } from '../../lib/useTournament';

export default function MatchControl() {
  const { id, tournament } = useLocalSearchParams<{ id: string; tournament: string }>();
  const { data } = useTournament(tournament);
  const match = data.matches.find((m) => m.id === id);
  const [winner, setWinner] = useState<string | null>(null);
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (match?.winner_id) setWinner(match.winner_id);
  }, [match?.winner_id]);

  if (!match) return <Screen>{null}</Screen>;

  const tg = data.tgames.find((x) => x.id === match.tournament_game_id);
  const game = tg ? data.games.get(tg.game_id) : undefined;
  const total = Math.max(...data.matches.filter((m) => m.tournament_game_id === match.tournament_game_id).map((m) => m.round));
  const a = match.team_a_id ? data.teams.get(match.team_a_id) : undefined;
  const b = match.team_b_id ? data.teams.get(match.team_b_id) : undefined;
  const canEnd = (match.status === 'live' || match.status === 'ready') && a && b;
  const num = (s: string) => (s.trim() === '' ? null : Number(s));

  const run = async (label: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
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

  const confirmEnd = () => {
    const w = winner === match.team_a_id ? a : b;
    Alert.alert('End match?', `${w?.name} wins${scoreA || scoreB ? ` ${scoreA || 0}–${scoreB || 0}` : ''}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End match', onPress: () => run('end', () => rpc('end_match', { p_match_id: match.id, p_winner_id: winner, p_score_a: num(scoreA), p_score_b: num(scoreB) }), () => router.back()) },
    ]);
  };

  const confirmReopen = () =>
    Alert.alert('Undo this result?', 'The winner is removed from the next match.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reopen', style: 'destructive', onPress: () => run('reopen', () => rpc('reopen_match', { p_match_id: match.id })) },
    ]);

  const side = (team: typeof a, tid: string | null) => {
    const picked = winner != null && winner === tid;
    return (
      <Pressable
        disabled={!canEnd}
        onPress={() => setWinner(tid)}
        style={[styles.card, { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 18 }, picked && { borderColor: colors.lime, backgroundColor: 'rgba(182,255,0,0.1)', shadowColor: colors.lime, shadowOpacity: 0.6, shadowRadius: 16, elevation: 8 }]}
      >
        <Avatar name={team?.name ?? '?'} url={team?.logo_url} size={56} />
        <Text style={[styles.text, { fontWeight: '800', textAlign: 'center' }]}>{team?.name ?? 'TBD'}</Text>
        {team && team.members.length > 0 && <Text style={[styles.muted, { fontSize: 12, textAlign: 'center' }]}>{team.members.join(', ')}</Text>}
        {picked && <Text style={{ color: colors.lime, fontWeight: '900', letterSpacing: 3, textShadowColor: colors.lime, textShadowRadius: 10 }}>WINNER</Text>}
      </Pressable>
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: `${game?.name ?? ''} · ${roundName(match.round, total)}` }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pill status={match.status} />
          {match.status === 'live' && match.started_at && <Elapsed since={match.started_at} />}
          {match.station ? <Text style={styles.muted}>Station {match.station}</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'stretch' }}>
          {side(a, match.team_a_id)}
          <Text style={{ color: colors.magenta, fontWeight: '900', fontStyle: 'italic', fontSize: 24, alignSelf: 'center', textShadowColor: colors.magenta, textShadowRadius: 12 }}>VS</Text>
          {side(b, match.team_b_id)}
        </View>

        {canEnd && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>SCORE {a?.name?.toUpperCase()}</Text>
              <TextInput style={styles.input} keyboardType="number-pad" value={scoreA} onChangeText={setScoreA} placeholder="optional" placeholderTextColor={colors.muted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>SCORE {b?.name?.toUpperCase()}</Text>
              <TextInput style={styles.input} keyboardType="number-pad" value={scoreB} onChangeText={setScoreB} placeholder="optional" placeholderTextColor={colors.muted} />
            </View>
          </View>
        )}

        <ErrorText message={error} />

        {match.status === 'ready' && (
          <Button title="Start match" busy={busy === 'start'} onPress={() => run('start', () => rpc('start_match', { p_match_id: match.id }))} />
        )}
        {canEnd && <Button title={winner ? 'End & set winner' : 'Tap the winner above'} variant="success" disabled={!winner} busy={busy === 'end'} onPress={confirmEnd} />}
        {match.status === 'completed' && !match.is_bye && <Button title="Reopen result" variant="danger" busy={busy === 'reopen'} onPress={confirmReopen} />}
        {match.status === 'pending' && <Text style={styles.muted}>Waiting for the earlier matches to finish.</Text>}

        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16, gap: 10 }}>
          <Text style={styles.label}>MATCH PHOTO</Text>
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

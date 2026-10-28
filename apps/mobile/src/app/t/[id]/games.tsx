import { scoringLabel } from '@dlc/core';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { FormatFields, defaultFormat, type FormatSettings } from '../../../components/format';
import { Button, colors, ErrorText, MenuRow, Screen, styles } from '../../../components/ui';
import { supabase } from '../../../lib/supabase';
import { useTournament } from '../../../lib/useTournament';

/** The games a tournament plays, and adding another from the catalog. */
export default function Games() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useTournament(id);
  const tgames = [...data.tgames].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const available = [...data.games.values()].filter((g) => !tgames.some((tg) => tg.game_id === g.id)).sort((a, b) => a.name.localeCompare(b.name));
  const [gameId, setGameId] = useState('');
  const [format, setFormat] = useState<FormatSettings>(defaultFormat);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const game = data.games.get(gameId);
    if (!game) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from('tournament_games')
      .insert({ tournament_id: id, game_id: game.id, match_minutes: game.default_match_minutes, buffer_minutes: 5, stations_required: 1, ...format });
    setBusy(false);
    if (error) return setError(error.message);
    setGameId('');
    setFormat(defaultFormat);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Games & players' }} />
      <ScrollView contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {tgames.length === 0 && <Text style={styles.muted}>No games yet. Add one below.</Text>}
        {tgames.map((tg) => {
          const game = data.games.get(tg.game_id);
          const count = [...data.teams.values()].filter((t) => t.tournament_game_id === tg.id).length;
          const solo = (game?.team_size ?? 1) === 1;
          return (
            <MenuRow
              key={tg.id}
              title={game?.name ?? 'Game'}
              sub={`${count} ${solo ? 'players' : 'teams'} · ${tg.format === 'groups' ? `${tg.group_count} groups, then knockout` : 'knockout'} · ${game ? scoringLabel(game) : ''}`}
              onPress={() => router.push({ pathname: '/t/[id]/game/[tg]', params: { id, tg: tg.id } })}
            />
          );
        })}

        <View style={[styles.card, { gap: 14, marginTop: 10 }]}>
          <Text style={styles.label}>Add a game</Text>
          {available.length === 0 ? (
            <Text style={styles.muted}>Every game in the catalog is already in this tournament.</Text>
          ) : (
            <View style={{ gap: 8 }}>
              {available.map((g) => (
                <Button
                  key={g.id}
                  title={`${g.name} (${g.team_size === 1 ? 'solo' : `${g.team_size} per side`})`}
                  variant="ghost"
                  style={gameId === g.id ? { borderColor: colors.ember, backgroundColor: 'rgba(255,42,74,0.18)' } : undefined}
                  onPress={() => setGameId(gameId === g.id ? '' : g.id)}
                />
              ))}
            </View>
          )}
          {gameId ? (
            <>
              <FormatFields value={format} onChange={setFormat} />
              <Button title={`Add ${data.games.get(gameId)?.name ?? 'game'}`} busy={busy} onPress={add} />
            </>
          ) : null}
          <ErrorText message={error} />
          <Button title="Manage the game catalog" variant="ghost" onPress={() => router.push('/catalog')} />
        </View>
      </ScrollView>
    </Screen>
  );
}

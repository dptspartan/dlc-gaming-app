import { scoringLabel, type Game } from '@dlc/core';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Avatar, Button, colors, ErrorText, Screen, styles } from '../../components/ui';
import { supabase } from '../../lib/supabase';

/** Games any tournament can add. */
export default function Catalog() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('games').select('*').order('name');
    setLoading(false);
    if (error) setError(error.message);
    else setGames(data as Game[]);
  }, []);
  // Back from editing a game: show the change.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Game catalog' }} />
      <ErrorText message={error} />
      <FlatList
        data={games}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.ember} />}
        ListHeaderComponent={<Button title="Add a game" onPress={() => router.push({ pathname: '/catalog/[id]', params: { id: 'new' } })} style={{ marginBottom: 4 }} />}
        renderItem={({ item: g }) => (
          <Pressable onPress={() => router.push({ pathname: '/catalog/[id]', params: { id: g.id } })} style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
            <Avatar name={g.name} url={g.cover_url} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.text, { fontWeight: '800', fontSize: 17 }]}>{g.name}</Text>
              <Text style={[styles.muted, { fontSize: 14 }]}>
                {g.team_size === 1 ? 'Solo' : `${g.team_size} per side`} · ~{g.default_match_minutes} min · {scoringLabel(g)}
              </Text>
            </View>
            <Text style={{ color: colors.ember, fontSize: 24, fontWeight: '800' }}>›</Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}

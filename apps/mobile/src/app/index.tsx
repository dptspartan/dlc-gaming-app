import type { Tournament } from '@dlc/core';
import { Link, Redirect, Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { colors, ErrorText, Pill, Screen, styles } from '../components/ui';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

const order: Record<string, number> = { live: 0, scheduled: 1, draft: 2, finished: 3 };

export default function Tournaments() {
  const { session, isAdmin, loading } = useAuth();
  const [list, setList] = useState<Tournament[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const { data, error } = await supabase.from('tournaments').select('*').order('start_date', { ascending: false });
    setRefreshing(false);
    if (error) setError(error.message);
    else setList((data as Tournament[]).sort((a, b) => order[a.status] - order[b.status]));
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  if (loading) return <Screen>{null}</Screen>;
  if (!session || !isAdmin) return <Redirect href="/login" />;

  return (
    <Screen>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => supabase.auth.signOut()}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>Sign out</Text>
            </Pressable>
          ),
        }}
      />
      <ErrorText message={error} />
      <FlatList
        data={list}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.cyan} />}
        ListEmptyComponent={<Text style={styles.muted}>No tournaments yet. Create one on the web admin.</Text>}
        renderItem={({ item }) => (
          <Link href={{ pathname: '/t/[id]', params: { id: item.id } }} asChild>
            <Pressable style={[styles.card, item.status === 'live' && styles.cardLive]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[styles.text, { fontWeight: '800', fontSize: 18, flex: 1 }]}>{item.name}</Text>
                <Pill status={item.status} />
              </View>
              <Text style={[styles.muted, { marginTop: 4 }]}>
                {item.start_date} · {item.days} day{item.days > 1 ? 's' : ''} · {item.daily_start.slice(0, 5)}–{item.daily_end.slice(0, 5)}
              </Text>
            </Pressable>
          </Link>
        )}
      />
    </Screen>
  );
}

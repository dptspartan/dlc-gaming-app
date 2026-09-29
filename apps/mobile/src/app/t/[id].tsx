import { formatTime, roundName, type Match } from '@dlc/core';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, SectionList, Text, View } from 'react-native';
import { Avatar, colors, Elapsed, ErrorText, Pill, Screen, styles } from '../../components/ui';
import { useTournament } from '../../lib/useTournament';

export default function TournamentMatches() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, reload } = useTournament(id);
  const [gameFilter, setGameFilter] = useState<string | null>(null);
  const tz = data.tournament?.timezone ?? 'UTC';

  const rounds = useMemo(() => {
    const r = new Map<string, number>();
    for (const m of data.matches) r.set(m.tournament_game_id, Math.max(r.get(m.tournament_game_id) ?? 0, m.round));
    return r;
  }, [data.matches]);

  const sections = useMemo(() => {
    const list = data.matches.filter((m) => !m.is_bye && (!gameFilter || m.tournament_game_id === gameFilter));
    const byTime = (a: Match, b: Match) => (a.scheduled_start ?? '9').localeCompare(b.scheduled_start ?? '9');
    return [
      { title: 'LIVE NOW', data: list.filter((m) => m.status === 'live').sort(byTime) },
      { title: 'READY TO START', data: list.filter((m) => m.status === 'ready').sort(byTime) },
      { title: 'WAITING FOR TEAMS', data: list.filter((m) => m.status === 'pending').sort(byTime) },
      {
        title: 'FINISHED',
        data: list.filter((m) => m.status === 'completed').sort((a, b) => (b.ended_at ?? '').localeCompare(a.ended_at ?? '')),
      },
    ].filter((s) => s.data.length > 0);
  }, [data.matches, gameFilter]);

  const gameName = (tgId: string) => {
    const tg = data.tgames.find((x) => x.id === tgId);
    return tg ? data.games.get(tg.game_id)?.name ?? '' : '';
  };
  const team = (tid: string | null) => (tid ? data.teams.get(tid) : undefined);

  return (
    <Screen>
      <Stack.Screen options={{ title: data.tournament?.name ?? 'Matches' }} />
      <ErrorText message={error} />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12, gap: 8 }}>
          {[{ id: null as string | null, label: 'All games' }, ...data.tgames.map((tg) => ({ id: tg.id as string | null, label: data.games.get(tg.game_id)?.name ?? '' }))].map(
            (chip) => (
              <Pressable
                key={chip.id ?? 'all'}
                onPress={() => setGameFilter(chip.id)}
                style={[styles.pill, { paddingHorizontal: 12, paddingVertical: 8, borderColor: gameFilter === chip.id ? colors.cyan : colors.border }]}
              >
                <Text style={{ color: gameFilter === chip.id ? colors.cyan : colors.muted, fontWeight: '800' }}>{chip.label}</Text>
              </Pressable>
            ),
          )}
        </ScrollView>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(m) => m.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.cyan} />}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 40 }}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={!loading ? <Text style={[styles.muted, { padding: 12 }]}>No fixtures yet. Generate them on the web admin.</Text> : null}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.label, { color: section.title === 'LIVE NOW' ? colors.magenta : colors.muted, marginTop: 16 }]}>{section.title}</Text>
        )}
        renderItem={({ item: m }) => {
          const a = team(m.team_a_id);
          const b = team(m.team_b_id);
          return (
            <Link href={{ pathname: '/match/[id]', params: { id: m.id, tournament: id } }} asChild>
              <Pressable style={[styles.card, { marginBottom: 8 }, m.status === 'live' && { borderColor: colors.magenta }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={[styles.muted, { fontSize: 12 }]}>
                    {gameName(m.tournament_game_id)} · {roundName(m.round, rounds.get(m.tournament_game_id) ?? m.round)}
                    {m.station ? ` · Stn ${m.station}` : ''} · {formatTime(m.scheduled_start, tz)}
                  </Text>
                  {m.status === 'live' && m.started_at ? <Elapsed since={m.started_at} /> : <Pill status={m.status} />}
                </View>
                {[a, b].map((t, i) => {
                  const tid = i === 0 ? m.team_a_id : m.team_b_id;
                  const won = m.winner_id != null && m.winner_id === tid;
                  return (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 }}>
                      <Avatar name={t?.name ?? '?'} url={t?.logo_url} size={26} />
                      <Text style={[styles.text, { flex: 1, fontWeight: '700', color: won ? colors.lime : t ? colors.text : colors.muted }]}>
                        {t?.name ?? 'TBD'}
                      </Text>
                      <Text style={[styles.text, { fontWeight: '800' }]}>{(i === 0 ? m.score_a : m.score_b) ?? ''}</Text>
                    </View>
                  );
                })}
              </Pressable>
            </Link>
          );
        }}
      />
    </Screen>
  );
}

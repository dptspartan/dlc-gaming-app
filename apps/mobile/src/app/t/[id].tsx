import { formatTime, knockoutRounds, matchLabel, stationBoard, type Match } from '@dlc/core';
import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, SectionList, Text, View } from 'react-native';
import { StationCard } from '../../components/station';
import { Avatar, CallCountdown, colors, Elapsed, ErrorText, Pill, Screen, styles } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useTournament, type TournamentData } from '../../lib/useTournament';

type View_ = 'mine' | 'stations' | 'matches';

/** A tournament for its game masters: their stations first, then the whole venue and every match. */
export default function TournamentHub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, error, reload } = useTournament(id);
  const { session } = useAuth();
  const mine = data.masters.filter((m) => m.user_id === session?.user.id).map((m) => m.station);
  const [picked, setPicked] = useState<View_ | null>(null);
  const view = picked ?? (mine.length ? 'mine' : 'stations');
  const board = useMemo(() => stationBoard(data.matches, data.tournament?.stations ?? 0), [data.matches, data.tournament?.stations]);

  const tabs: [View_, string][] = [
    ['mine', `My stations${mine.length ? ` (${mine.length})` : ''}`],
    ['stations', 'All stations'],
    ['matches', 'Matches'],
  ];

  return (
    <Screen>
      <Stack.Screen options={{ title: data.tournament?.name ?? 'Tournament' }} />
      <View style={{ flexDirection: 'row', gap: 6, padding: 12, paddingBottom: 4 }}>
        {tabs.map(([k, label]) => (
          <Pressable
            key={k}
            onPress={() => setPicked(k)}
            style={{
              flex: 1,
              paddingVertical: 11,
              borderRadius: 10,
              borderWidth: 1,
              alignItems: 'center',
              borderColor: view === k ? colors.ember : colors.border,
              backgroundColor: view === k ? 'rgba(255,42,74,0.18)' : 'transparent',
            }}
          >
            <Text style={{ color: view === k ? colors.text : colors.muted, fontWeight: '800', fontSize: 14 }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorText message={error} />
      {view === 'matches' ? (
        <MatchList id={id} data={data} loading={loading} reload={reload} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.ember} />}
        >
          {view === 'mine' && mine.length === 0 && (
            <Text style={[styles.muted, { padding: 4 }]}>No station is assigned to you yet. An admin assigns game masters under Stations & staff on the web. Pick any station from All stations meanwhile.</Text>
          )}
          {board
            .filter((s) => view === 'stations' || mine.includes(s.station))
            .map((s) => {
              const master = data.masters.find((m) => m.station === s.station);
              return (
                <StationCard
                  key={s.station}
                  s={s}
                  data={data}
                  master={master ? (master.user_id === session?.user.id ? 'You' : 'Assigned') : undefined}
                  onPress={() => router.push({ pathname: '/station/[n]', params: { n: String(s.station), tournament: id } })}
                />
              );
            })}
        </ScrollView>
      )}
    </Screen>
  );
}

function MatchList({ id, data, loading, reload }: { id: string; data: TournamentData; loading: boolean; reload: () => void }) {
  const [gameFilter, setGameFilter] = useState<string | null>(null);
  const tz = data.tournament?.timezone ?? 'UTC';

  const rounds = useMemo(() => knockoutRounds(data.matches), [data.matches]);

  const sections = useMemo(() => {
    const list = data.matches.filter((m) => !m.is_bye && (!gameFilter || m.tournament_game_id === gameFilter));
    const byTime = (a: Match, b: Match) => (a.scheduled_start ?? '9').localeCompare(b.scheduled_start ?? '9');
    return [
      { title: 'Live now', data: list.filter((m) => m.status === 'live').sort(byTime) },
      { title: 'Players called', data: list.filter((m) => m.status === 'called').sort(byTime) },
      { title: 'In the queue', data: list.filter((m) => m.status === 'ready').sort(byTime) },
      { title: 'Waiting for teams', data: list.filter((m) => m.status === 'pending').sort(byTime) },
      {
        title: 'Finished',
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
    <>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12, gap: 8 }}>
          {[{ id: null as string | null, label: 'All games' }, ...data.tgames.map((tg) => ({ id: tg.id as string | null, label: data.games.get(tg.game_id)?.name ?? '' }))].map(
            (chip) => (
              <Pressable
                key={chip.id ?? 'all'}
                onPress={() => setGameFilter(chip.id)}
                style={[styles.pill, { paddingHorizontal: 12, paddingVertical: 8, borderColor: gameFilter === chip.id ? colors.ember : colors.border }]}
              >
                <Text style={{ color: gameFilter === chip.id ? colors.ember : colors.muted, fontWeight: '800' }}>{chip.label}</Text>
              </Pressable>
            ),
          )}
        </ScrollView>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(m) => m.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.ember} />}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 40 }}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={!loading ? <Text style={[styles.muted, { padding: 12 }]}>No fixtures yet. Generate them on the web admin.</Text> : null}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.label, { color: section.title === 'Live now' ? colors.flame : section.title === 'Players called' ? colors.gold : colors.text, marginTop: 16 }]}>
            {section.title}
          </Text>
        )}
        renderItem={({ item: m }) => {
          const a = team(m.team_a_id);
          const b = team(m.team_b_id);
          return (
            <Link href={{ pathname: '/match/[id]', params: { id: m.id, tournament: id } }} asChild>
              <Pressable style={[styles.card, { marginBottom: 8 }, m.status === 'live' && styles.cardLive, m.status === 'called' && styles.cardCalled]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={[styles.muted, { fontSize: 14, flex: 1 }]}>
                    {m.station ? `Station ${m.station} · ` : ''}
                    {formatTime(m.scheduled_start, tz)} · {gameName(m.tournament_game_id)} · {matchLabel(m, rounds.get(m.tournament_game_id) ?? m.round)}
                  </Text>
                  {m.status === 'live' && m.started_at ? (
                    <Elapsed since={m.started_at} />
                  ) : m.status === 'called' && m.called_at ? (
                    <CallCountdown calledAt={m.called_at} minutes={data.tournament?.call_minutes ?? 5} size={16} />
                  ) : (
                    <Pill status={m.status} />
                  )}
                </View>
                {[a, b].map((t, i) => {
                  const tid = i === 0 ? m.team_a_id : m.team_b_id;
                  const won = m.winner_id != null && m.winner_id === tid;
                  return (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 }}>
                      <Avatar name={t?.name ?? '?'} url={t?.logo_url} size={26} />
                      <Text style={[styles.text, { flex: 1, fontWeight: '700', color: won ? colors.gold : t ? colors.text : colors.muted }]}>
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
    </>
  );
}

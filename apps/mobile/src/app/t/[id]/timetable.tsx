import { formatDay, formatTime, stationLabel, zonedDate, type Match, type TimetableResult } from '@dlc/core';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { FitNote } from '../../../components/fitnote';
import { EndOfDayCard } from '../../../components/reschedule';
import { describe, teamName } from '../../../components/station';
import { Button, colors, ErrorText, Pill, Screen, styles } from '../../../components/ui';
import { refreshTimetable } from '../../../lib/actions';
import { moveMatch, previewTimetable } from '../../../lib/setup';
import { useTournament } from '../../../lib/useTournament';

/** Every match still to play in time order, to swap neighbours or rebuild the times. */
export default function Timetable() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, reload } = useTournament(id);
  const t = data.tournament;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TimetableResult | null>(null);
  const fit = useMemo(() => (t && data.matches.length ? previewTimetable(t, data.tgames, data.matches, data.games.values()) : null), [t, data.tgames, data.matches, data.games]);

  if (!t) return <Screen>{null}</Screen>;
  const tz = t.timezone;
  const count = (st: Match['status']) => data.matches.filter((m) => m.status === st && !m.is_bye).length;
  const queued = (m: Match) => !m.is_bye && (m.status === 'pending' || m.status === 'ready');
  const list = data.matches
    .filter((m) => !m.is_bye && m.status !== 'completed')
    .sort((a, b) => (a.scheduled_start ?? '9').localeCompare(b.scheduled_start ?? '9'));

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
  const move = (m: Match, direction: 'earlier' | 'later') =>
    act(`${direction}-${m.id}`, () => moveMatch(t, data.tgames, data.matches, m.id, direction, data.games.values(), (tid) => data.teams.get(tid)?.name ?? 'A player'));

  let lastDay = '';
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Timetable' }} />
      <ScrollView contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 64 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.ember} />}>
        <View style={[styles.card, { gap: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {(
              [
                ['Live', count('live'), colors.flame],
                ['Called', count('called'), colors.gold],
                ['Ready', count('ready'), colors.text],
                ['Waiting', count('pending'), colors.muted],
              ] as const
            ).map(([label, n, color]) => (
              <View key={label} style={{ alignItems: 'center', flex: 1 }}>
                <Text style={{ color, fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{n}</Text>
                <Text style={[styles.muted, { fontSize: 13 }]}>{label}</Text>
              </View>
            ))}
          </View>
          <Button title="Rebuild timetable" variant="ghost" busy={busy === 'reflow'} disabled={!!busy || !data.matches.length} onPress={() => act('reflow', () => refreshTimetable(t.id))} />
          <FitNote result={result ?? fit} tz={tz} />
          <Text style={[styles.muted, { fontSize: 14 }]}>
            Earlier and Later swap a match with the one next to it. Reschedule gives it a set time; the other matches move round it, and no match starts before its
            players are free.
          </Text>
        </View>
        <ErrorText message={error} />
        <EndOfDayCard data={data} />
        {list.length === 0 && <Text style={styles.muted}>{data.matches.length ? 'Every match has been played.' : 'No fixtures yet. Generate them under Fixtures.'}</Text>}
        {list.map((m) => {
          const day = m.scheduled_start ? zonedDate(m.scheduled_start, tz) : '';
          const header = day !== lastDay ? (m.scheduled_start ? formatDay(m.scheduled_start, tz) : 'No time yet') : null;
          lastDay = day;
          return (
            <View key={m.id} style={{ gap: 8 }}>
              {header && <Text style={[styles.label, { marginTop: 8, marginBottom: 0 }]}>{header}</Text>}
              <View style={[styles.card, { padding: 12, gap: 6 }, m.status === 'live' && styles.cardLive, m.status === 'called' && styles.cardCalled]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ color: colors.ember, fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'], minWidth: 58 }}>{m.scheduled_start ? formatTime(m.scheduled_start, tz) : '–'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.text, { fontWeight: '800' }]} numberOfLines={2}>
                      {teamName(data, m.team_a_id)} <Text style={{ color: colors.muted }}>v</Text> {teamName(data, m.team_b_id)}
                    </Text>
                    <Text style={[styles.muted, { fontSize: 13 }]} numberOfLines={1}>
                      {m.station ? `${stationLabel(m)} · ` : ''}
                      {describe(data, m)}
                      {m.time_locked ? ' · set time' : ''}
                    </Text>
                  </View>
                  <Pill status={m.status} />
                </View>
                {queued(m) ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Button title="↑ Earlier" variant="ghost" style={{ flex: 1, paddingVertical: 11 }} busy={busy === `earlier-${m.id}`} disabled={!!busy} onPress={() => move(m, 'earlier')} />
                    <Button title="↓ Later" variant="ghost" style={{ flex: 1, paddingVertical: 11 }} busy={busy === `later-${m.id}`} disabled={!!busy} onPress={() => move(m, 'later')} />
                    <Button
                      title="Reschedule"
                      variant="ghost"
                      style={{ flex: 1, paddingVertical: 11 }}
                      disabled={!!busy}
                      onPress={() => router.push({ pathname: '/match/[id]', params: { id: m.id, tournament: id } })}
                    />
                  </View>
                ) : (
                  <Button title="Open match" variant="ghost" style={{ paddingVertical: 11 }} onPress={() => router.push({ pathname: '/match/[id]', params: { id: m.id, tournament: id } })} />
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

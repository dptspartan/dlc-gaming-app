import { formatTime, stationBoard, stationLabel, type Match } from '@dlc/core';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { callableAt, describe, teamName } from '../../components/station';
import { Button, CallCountdown, colors, Elapsed, ErrorText, Screen, styles } from '../../components/ui';
import { callMatch, holdMatch, startMatch, uncallMatch } from '../../lib/actions';
import { useTournament } from '../../lib/useTournament';

/** Run one station: call the players, start the match, or move the queue around. */
export default function StationScreen() {
  const { n, tournament } = useLocalSearchParams<{ n: string; tournament: string }>();
  const station = Number(n);
  const { data, loading, reload } = useTournament(tournament);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = data.tournament;
  if (!t) return <Screen>{null}</Screen>;

  const s = stationBoard(data.matches, t.stations)[station - 1];
  if (!s) return <Screen>{null}</Screen>;
  const m = s.current;
  const callable = callableAt(data, station);
  const plannedHere = s.queue;
  const elsewhere = callable.filter((c) => c.station !== station);
  const next = plannedHere.find((q) => q.status === 'ready' && q.team_a_id && q.team_b_id) ?? callable[0];
  const tz = t.timezone;
  const name = (id: string | null) => teamName(data, id);

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
  const openMatch = (x: Match) => router.push({ pathname: '/match/[id]', params: { id: x.id, tournament } });

  const row = (q: Match, actions: 'call' | 'queue') => (
    <View key={q.id} style={[styles.card, { gap: 8, padding: 12 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={[styles.text, { fontWeight: '800', flex: 1 }]}>
          {name(q.team_a_id)} <Text style={{ color: colors.muted }}>vs</Text> {name(q.team_b_id)}
        </Text>
        <Text style={{ color: colors.ember, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatTime(q.scheduled_start, tz)}</Text>
      </View>
      <Text style={styles.muted}>
        {describe(data, q)}
        {q.station && q.station !== station ? ` · planned for ${stationLabel(q)}` : ''}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {q.status === 'ready' && q.team_a_id && q.team_b_id ? (
          <Button title="Call here" style={{ flex: 1 }} disabled={!!m || !!busy} busy={busy === `call-${q.id}`} onPress={() => run(`call-${q.id}`, () => callMatch(q, station))} />
        ) : (
          <Text style={[styles.muted, { flex: 1, alignSelf: 'center' }]}>Waiting for earlier results</Text>
        )}
        {actions === 'queue' && (
          <Button
            title="Later +10 min"
            variant="ghost"
            style={{ flex: 1 }}
            disabled={!!busy}
            busy={busy === `hold-${q.id}`}
            onPress={() => run(`hold-${q.id}`, () => holdMatch(q, new Date(Date.now() + 10 * 60_000)))}
          />
        )}
      </View>
    </View>
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: `Station ${station}` }} />
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.ember} />}>
        <Text style={styles.label}>On this station</Text>
        {m ? (
          <View style={[styles.card, { gap: 10 }, m.status === 'live' ? styles.cardLive : styles.cardCalled]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: m.status === 'live' ? colors.flame : colors.gold, fontWeight: '900', fontSize: 17 }}>{m.status === 'live' ? 'LIVE' : 'Waiting for players'}</Text>
              {m.status === 'live' && m.started_at ? <Elapsed since={m.started_at} /> : null}
              {m.status === 'called' && m.called_at ? <CallCountdown calledAt={m.called_at} minutes={t.call_minutes} size={26} /> : null}
            </View>
            <Text style={{ color: colors.text, fontSize: 24, fontWeight: '900' }}>
              {name(m.team_a_id)} <Text style={{ color: colors.muted, fontSize: 18 }}>vs</Text> {name(m.team_b_id)}
            </Text>
            <Text style={styles.muted}>
              {describe(data, m)}
              {(m.stations?.length ?? 0) > 1 ? ` · ${stationLabel(m)}` : ''}
            </Text>
            {m.status === 'called' ? (
              <>
                <Button title="Players are here, start" busy={busy === 'start'} disabled={!!busy} onPress={() => run('start', () => startMatch(m))} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title="Skip 10 min" variant="ghost" style={{ flex: 1 }} disabled={!!busy} busy={busy === 'skip'} onPress={() => run('skip', () => uncallMatch(m, 10))} />
                  <Button title="Cancel call" variant="ghost" style={{ flex: 1 }} disabled={!!busy} busy={busy === 'cancel'} onPress={() => run('cancel', () => uncallMatch(m, 0))} />
                </View>
                <Button title="No-show or walkover" variant="ghost" onPress={() => openMatch(m)} />
              </>
            ) : (
              <Button title="Score & finish" onPress={() => openMatch(m)} />
            )}
          </View>
        ) : (
          <View style={[styles.card, { gap: 10 }]}>
            <Text style={[styles.text, { fontWeight: '800' }]}>This station is free.</Text>
            {next ? (
              <>
                <Text style={styles.muted}>
                  Calling puts {name(next.team_a_id)} v {name(next.team_b_id)} on the live board with a {t.call_minutes} minute countdown.
                </Text>
                <Button title={`Call ${name(next.team_a_id)} v ${name(next.team_b_id)}`} busy={busy === 'next'} disabled={!!busy} onPress={() => run('next', () => callMatch(next, station))} />
              </>
            ) : (
              <Text style={styles.muted}>No match is ready for this station yet.</Text>
            )}
          </View>
        )}

        <ErrorText message={error} />

        <Text style={[styles.label, { marginTop: 8 }]}>Planned here</Text>
        {plannedHere.length === 0 && <Text style={styles.muted}>Nothing planned on this station.</Text>}
        {plannedHere.map((q) => row(q, 'queue'))}

        {elsewhere.length > 0 && (
          <>
            <Text style={[styles.label, { marginTop: 8 }]}>Can also play here</Text>
            <Text style={[styles.muted, { marginTop: -4 }]}>Ready matches planned elsewhere. Call one here if its station is busy or a match was skipped.</Text>
            {elsewhere.map((q) => row(q, 'call'))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Button, Choices, colors, ErrorText, Field, Screen, styles } from '../../../components/ui';
import { refreshTimetable } from '../../../lib/actions';
import { listAdmins } from '../../../lib/setup';
import { supabase } from '../../../lib/supabase';
import { useTournament } from '../../../lib/useTournament';

/** Stations at the venue, the call countdown, whether times move, and who runs each station. */
export default function Staff() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useTournament(id);
  const t = data.tournament;
  const [stations, setStations] = useState('');
  const [callMinutes, setCallMinutes] = useState('');
  const [autoTimes, setAutoTimes] = useState(true);
  const [admins, setAdmins] = useState<{ user_id: string; email: string }[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!t || loaded) return;
    setStations(String(t.stations));
    setCallMinutes(String(t.call_minutes));
    setAutoTimes(t.auto_times !== false);
    setLoaded(true);
  }, [t, loaded]);

  const loadAdmins = useCallback(() => listAdmins().then(setAdmins, (e: Error) => setError(e.message)), []);
  useEffect(() => void loadAdmins(), [loadAdmins]);

  if (!t) return <Screen>{null}</Screen>;

  const save = async () => {
    const s = Number(stations);
    const c = Number(callMinutes);
    if (!Number.isInteger(s) || s < 1 || s > 64) return setError('Stations must be between 1 and 64.');
    if (!Number.isInteger(c) || c < 1 || c > 60) return setError('Minutes to reach a station must be between 1 and 60.');
    setBusy('save');
    setError(null);
    try {
      const { error } = await supabase.from('tournaments').update({ stations: s, call_minutes: c, auto_times: autoTimes }).eq('id', t.id);
      if (error) throw new Error(error.message);
      if (data.matches.length) await refreshTimetable(t.id);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const assign = async (station: number, userId: string | null) => {
    setBusy(`m${station}`);
    setError(null);
    const { error } = userId
      ? await supabase.from('station_masters').upsert({ tournament_id: t.id, station, user_id: userId })
      : await supabase.from('station_masters').delete().eq('tournament_id', t.id).eq('station', station);
    setBusy(null);
    setOpen(null);
    if (error) setError(error.message);
  };

  const email = new Map(admins.map((a) => [a.user_id, a.email]));
  const gamesOn = (n: number) =>
    data.tgames
      .filter((tg) => !tg.allowed_stations?.length || tg.allowed_stations.includes(n))
      .map((tg) => data.games.get(tg.game_id)?.name)
      .filter(Boolean)
      .join(', ');
  const dirty = loaded && (stations !== String(t.stations) || callMinutes !== String(t.call_minutes) || autoTimes !== (t.auto_times !== false));

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Station staff' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field label="STATIONS" hint="Numbered 1, 2, 3…" style={{ flex: 1 }} keyboardType="number-pad" value={stations} onChangeText={(v) => (setSaved(false), setStations(v))} />
            <Field label="MINUTES TO REACH ONE" hint="Countdown after a call" style={{ flex: 1 }} keyboardType="number-pad" value={callMinutes} onChangeText={(v) => (setSaved(false), setCallMinutes(v))} />
          </View>
          <Choices
            label="MATCH TIMES"
            value={autoTimes ? 'auto' : 'planned'}
            onChange={(v) => (setSaved(false), setAutoTimes(v === 'auto'))}
            options={[
              ['auto', 'Move automatically'],
              ['planned', 'Keep planned times'],
            ]}
            hint={autoTimes ? 'Queued matches move later when matches run late.' : 'Every match keeps its planned time and station.'}
          />
          <Button title={saved && !dirty ? 'Saved, timetable rebuilt' : 'Save'} busy={busy === 'save'} disabled={!!busy || !dirty} onPress={save} />
          <ErrorText message={error} />

          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16, gap: 10 }}>
            <Text style={styles.label}>Game masters</Text>
            <Text style={[styles.muted, { marginTop: -4 }]}>A game master runs one or more stations from this app: calling players, starting matches and scoring them.</Text>
            {Array.from({ length: t.stations }, (_, i) => i + 1).map((n) => {
              const master = data.masters.find((m) => m.station === n);
              return (
                <View key={n} style={[styles.card, { gap: 8, padding: 12 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ color: colors.text, fontSize: 22, fontWeight: '900', width: 44 }}>#{n}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.text, { fontWeight: '700' }]}>{master ? email.get(master.user_id) ?? 'An admin' : 'No game master'}</Text>
                      <Text style={[styles.muted, { fontSize: 13 }]}>{gamesOn(n) || 'No game plays here'}</Text>
                    </View>
                    <Button title={open === n ? 'Close' : 'Change'} variant="ghost" style={{ paddingVertical: 10 }} busy={busy === `m${n}`} onPress={() => setOpen(open === n ? null : n)} />
                  </View>
                  {open === n && (
                    <Choices
                      value={master?.user_id ?? ''}
                      onChange={(v) => assign(n, v || null)}
                      disabled={!!busy}
                      options={[['', 'Nobody'], ...admins.map((a): [string, string] => [a.user_id, a.email.split('@')[0]])]}
                    />
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

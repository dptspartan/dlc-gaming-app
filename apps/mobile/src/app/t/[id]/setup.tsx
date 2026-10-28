import { formatClock } from '@dlc/core';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { ErrorText, MenuRow, Screen, styles } from '../../../components/ui';
import { useTournament } from '../../../lib/useTournament';

/** Everything an organiser sets up for a tournament, as on the web admin's Setup tab. */
export default function Setup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error } = useTournament(id);
  const t = data.tournament;
  const go = (pathname: string) => router.push({ pathname: pathname as never, params: { id } });
  const games = data.tgames.length;
  const players = data.teams.size;
  const fixtures = data.matches.filter((m) => !m.is_bye).length;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Setup' }} />
      <ScrollView contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 48 }}>
        <ErrorText message={error} />
        <MenuRow
          title="Games & players"
          sub={games ? `${games} game${games === 1 ? '' : 's'} · ${players} player${players === 1 ? '' : 's'} or teams` : 'Add the games this tournament plays'}
          onPress={() => go('/t/[id]/games')}
        />
        <MenuRow title="Fixtures" sub={fixtures ? `${fixtures} matches · legs per round, knockout, matchups` : 'Generate brackets and groups'} onPress={() => go('/t/[id]/fixtures')} />
        <MenuRow title="Timetable" sub="Move matches earlier or later, rebuild the times" onPress={() => go('/t/[id]/timetable')} />
        <MenuRow title="Station staff" sub={t ? `${t.stations} stations · ${t.call_minutes} min to reach one · game masters` : undefined} onPress={() => go('/t/[id]/staff')} />
        <MenuRow
          title="Details"
          sub={t ? `${t.start_date} · ${t.days} day${t.days > 1 ? 's' : ''} · ${formatClock(t.daily_start)}–${formatClock(t.daily_end)} · ${t.status}` : undefined}
          onPress={() => go('/t/[id]/details')}
        />
        <Text style={[styles.muted, { marginTop: 8, fontSize: 13 }]}>Uploading a fixtures sheet (CSV) is on the web admin.</Text>
      </ScrollView>
    </Screen>
  );
}

import { formatTime, knockoutRounds, matchLabel, stationLabel, type Match, type StationState } from '@dlc/core';
import { Pressable, Text, View } from 'react-native';
import type { TournamentData } from '../lib/useTournament';
import { CallCountdown, colors, Elapsed, styles } from './ui';

export const teamName = (data: TournamentData, id: string | null) => (id ? data.teams.get(id)?.name ?? '?' : 'TBD');

export function gameName(data: TournamentData, m: Pick<Match, 'tournament_game_id'>) {
  const tg = data.tgames.find((x) => x.id === m.tournament_game_id);
  return tg ? data.games.get(tg.game_id)?.name ?? '' : '';
}

export function describe(data: TournamentData, m: Match) {
  const rounds = knockoutRounds(data.matches);
  return `${gameName(data, m)} · ${matchLabel(m, rounds.get(m.tournament_game_id) ?? m.round)}`;
}

/** Ready matches this station may host, planned-here first, then soonest. */
export function callableAt(data: TournamentData, station: number): Match[] {
  return data.matches
    .filter((m) => m.status === 'ready' && !m.is_bye && m.team_a_id && m.team_b_id)
    .filter((m) => {
      const allowed = data.tgames.find((tg) => tg.id === m.tournament_game_id)?.allowed_stations;
      return !allowed?.length || allowed.includes(station);
    })
    .sort((a, b) => Number(b.station === station) - Number(a.station === station) || (a.scheduled_start ?? '9').localeCompare(b.scheduled_start ?? '9'));
}

/** One station at a glance: what is on it and what is next. */
export function StationCard({ s, data, master, onPress }: { s: StationState<Match>; data: TournamentData; master?: string; onPress: () => void }) {
  const m = s.current;
  const next = s.queue[0];
  const tz = data.tournament?.timezone ?? 'UTC';
  return (
    <Pressable onPress={onPress} style={[styles.card, { gap: 6 }, m?.status === 'live' && styles.cardLive, m?.status === 'called' && styles.cardCalled]}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text, fontSize: 26, fontWeight: '900' }}>Station {s.station}</Text>
        {master ? <Text style={styles.muted}>{master}</Text> : null}
      </View>
      {m ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: m.status === 'live' ? colors.flame : colors.gold, fontWeight: '800', fontSize: 15 }}>
              {m.status === 'live' ? 'LIVE' : 'Waiting for players'}
              {(m.stations?.length ?? 0) > 1 ? ` · ${stationLabel(m)}` : ''}
            </Text>
            {m.status === 'live' && m.started_at ? <Elapsed since={m.started_at} /> : null}
            {m.status === 'called' && m.called_at && data.tournament ? <CallCountdown calledAt={m.called_at} minutes={data.tournament.call_minutes} /> : null}
          </View>
          <Text style={[styles.text, { fontWeight: '800', fontSize: 18 }]}>
            {teamName(data, m.team_a_id)} <Text style={{ color: colors.muted }}>vs</Text> {teamName(data, m.team_b_id)}
            {m.status === 'live' && m.score_a != null ? `   ${m.score_a ?? 0}:${m.score_b ?? 0}` : ''}
          </Text>
          <Text style={styles.muted}>{describe(data, m)}</Text>
        </>
      ) : (
        <Text style={[styles.muted, { color: colors.text }]}>Free</Text>
      )}
      {next && (
        <Text style={[styles.muted, { marginTop: 4 }]}>
          Next {formatTime(next.scheduled_start, tz)}: {gameName(data, next)}, {teamName(data, next.team_a_id)} v {teamName(data, next.team_b_id)}
        </Text>
      )}
    </Pressable>
  );
}

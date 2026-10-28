import { feederOf, placementOf, type Match, type Slot } from '@dlc/core';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { replacePlayer } from '../lib/setup';
import type { TournamentData } from '../lib/useTournament';
import { Button, Choices, colors, Field, styles } from './ui';

/** Finish a level score match on penalties: both shoot-out scores, the higher one wins. */
export function Penalties({ names, label, busy, onFinish }: { names: [string, string]; label: string; busy: boolean; onFinish: (a: number, b: number) => void }) {
  const [value, setValue] = useState({ a: '', b: '' });
  const pa = value.a === '' ? null : Number(value.a);
  const pb = value.b === '' ? null : Number(value.b);
  const valid = pa != null && pb != null && Number.isInteger(pa) && Number.isInteger(pb) && pa >= 0 && pb >= 0 && pa !== pb;
  const winner = valid ? (pa! > pb! ? names[0] : names[1]) : null;
  const digits = (t: string) => t.replace(/[^0-9]/g, '').slice(0, 2);
  return (
    <View style={[styles.card, { gap: 10 }]}>
      <Text style={styles.label}>Penalties</Text>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
        <Field label={names[0]} style={{ flex: 1 }} keyboardType="number-pad" value={value.a} onChangeText={(t) => setValue({ ...value, a: digits(t) })} />
        <Text style={[styles.muted, { paddingBottom: 14 }]}>–</Text>
        <Field label={names[1]} style={{ flex: 1 }} keyboardType="number-pad" value={value.b} onChangeText={(t) => setValue({ ...value, b: digits(t) })} />
      </View>
      {pa != null && pb != null && pa === pb && <Text style={{ color: colors.gold }}>A shoot-out needs a winner: the penalties can't be level.</Text>}
      <Button
        title={winner ? `Finish ${label} on penalties, ${winner} wins` : `Enter the penalties to finish the ${label}`}
        variant="success"
        busy={busy}
        disabled={!valid}
        onPress={() => valid && onFinish(pa!, pb!)}
      />
    </View>
  );
}

/**
 * Swap a player in a match that has not started: a late sign-up takes the
 * place, or a player still waiting for their first match swaps with them.
 */
export function ChangePlayers({ match, data, busy, run }: { match: Match; data: TournamentData; busy: boolean; run: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const [open, setOpen] = useState<Slot | null>(null);
  const inMatch = [match.team_a_id, match.team_b_id];
  const others = [...data.teams.values()]
    .filter((t) => t.tournament_game_id === match.tournament_game_id && !inMatch.includes(t.id))
    .map((t) => ({ team: t, at: placementOf(t.id, match.tournament_game_id, data.matches) }))
    .filter((o) => o.at.kind !== 'playing')
    .sort((x, y) => Number(x.at.kind !== 'free') - Number(y.at.kind !== 'free') || x.team.name.localeCompare(y.team.name));

  const row = (slot: Slot) => {
    const id = slot === 'a' ? match.team_a_id : match.team_b_id;
    const name = id ? data.teams.get(id)?.name ?? '?' : null;
    const feeder = feederOf(match, slot, data.matches);
    if (feeder)
      return (
        <Text key={slot} style={styles.muted}>
          {name ?? 'This place'} comes from {feeder.match_code ?? 'an earlier match'}. Change the players there instead.
        </Text>
      );
    const pick = (teamId: string) => {
      const chosen = others.find((o) => o.team.id === teamId);
      if (!chosen) return;
      const swap =
        chosen.at.kind === 'waiting' ? ` ${chosen.team.name} leaves ${chosen.at.match.match_code ?? 'their match'}${name ? ` and ${name} takes their place there` : ''}.` : '';
      Alert.alert(`Put ${chosen.team.name} in?`, `${name ? `They take the place of ${name}.` : 'They fill the empty place.'}${swap}`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', onPress: () => void run('lineup', () => replacePlayer(match, slot, chosen.team.id)).then(() => setOpen(null)) },
      ]);
    };
    return (
      <View key={slot} style={{ gap: 8 }}>
        <Button title={open === slot ? 'Close' : name ? `Replace ${name}` : 'Fill the empty place'} variant="ghost" disabled={busy} onPress={() => setOpen(open === slot ? null : slot)} />
        {open === slot &&
          (others.length ? (
            <Choices
              value=""
              disabled={busy}
              onChange={pick}
              options={others.map((o): [string, string] => [o.team.id, o.at.kind === 'waiting' ? `${o.team.name} (swap, ${o.at.match.match_code ?? 'another match'})` : o.team.name])}
              hint="Players not in a match yet first, then players waiting for their first match (they swap places)."
            />
          ) : (
            <Text style={styles.muted}>Nobody is free to come in. Add a player under Setup, Games & players.</Text>
          ))}
      </View>
    );
  };

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16, gap: 10 }}>
      <Text style={styles.label}>Change players</Text>
      {row('a')}
      {row('b')}
    </View>
  );
}

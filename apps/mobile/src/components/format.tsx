import type { Format, TournamentGame } from '@dlc/core';
import { View } from 'react-native';
import { Choices, Field } from './ui';

export type FormatSettings = Pick<TournamentGame, 'format' | 'group_count' | 'advance_per_group' | 'wildcards'>;

export const defaultFormat: FormatSettings = { format: 'knockout', group_count: 2, advance_per_group: 2, wildcards: 0 };
export const formatOf = (tg: TournamentGame): FormatSettings => ({
  format: tg.format,
  group_count: tg.group_count,
  advance_per_group: tg.advance_per_group,
  wildcards: tg.wildcards,
});

/** Knockout, or groups (how many, how many go through, wildcards) then a knockout. */
export function FormatFields({ value, onChange }: { value: FormatSettings; onChange: (v: FormatSettings) => void }) {
  const num = (key: keyof FormatSettings) => (text: string) => onChange({ ...value, [key]: Number(text.replace(/[^0-9]/g, '')) });
  return (
    <View style={{ gap: 12 }}>
      <Choices<Format>
        label="FORMAT"
        value={value.format}
        onChange={(format) => onChange({ ...value, format })}
        options={[
          ['knockout', 'Knockout'],
          ['groups', 'Groups, then knockout'],
        ]}
      />
      {value.format === 'groups' && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Field label="GROUPS" style={{ flex: 1 }} keyboardType="number-pad" value={String(value.group_count)} onChangeText={num('group_count')} />
          <Field label="GO THROUGH" style={{ flex: 1 }} keyboardType="number-pad" value={String(value.advance_per_group)} onChangeText={num('advance_per_group')} />
          <Field label="WILDCARDS" style={{ flex: 1 }} keyboardType="number-pad" value={String(value.wildcards)} onChangeText={num('wildcards')} />
        </View>
      )}
    </View>
  );
}
